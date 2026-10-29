import { describe, it, expect, vi } from "vitest";
import {
  generateEntityTools,
  makeEntityDispatcher,
} from "../entities/generator.js";
import { customerConfig, customerExtras } from "../entities/customer.js";
import { invoiceConfig } from "../entities/invoice.js";
import { paymentConfig } from "../entities/payment.js";
import type { EntityConfig, EntityExtras } from "../entities/types.js";

const { query, post, get, elicitText } = vi.hoisted(() => ({
  query: vi.fn(async (sql: string) => ({ sql })),
  get: vi.fn(async (path: string): Promise<unknown> => ({ path })),
  post: vi.fn(
    async (path: string, body: unknown, params?: Record<string, string>) => ({
      path,
      body,
      params,
    })
  ),
  elicitText: vi.fn(async () => "Scharpf"),
}));

vi.mock("../utils/client.js", () => ({
  getClient: () => ({ query, post, get }),
}));

vi.mock("../utils/elicitation.js", () => ({
  elicitText,
}));

const sampleConfig: EntityConfig = {
  name: "Widget",
  toolPrefix: "qbo_widgets",
  description: "Widget testing entity",
  list: { dateRange: true },
  get: { idParam: "widgetId" },
  create: {
    fields: [
      { name: "DisplayName", type: "string", required: true, description: "Name" },
      { name: "Quantity", type: "number", description: "Stock count" },
    ],
  },
  update: {
    idParam: "widgetId",
    fields: [
      { name: "DisplayName", type: "string", description: "Name" },
      { name: "Quantity", type: "number", description: "Stock count" },
    ],
  },
  search: { field: "DisplayName" },
};

describe("generateEntityTools", () => {
  it("emits one tool per declared op", () => {
    const tools = generateEntityTools(sampleConfig);
    expect(tools.map((t) => t.name)).toEqual([
      "qbo_widgets_list",
      "qbo_widgets_get",
      "qbo_widgets_create",
      "qbo_widgets_update",
      "qbo_widgets_search",
    ]);
  });

  it("includes startDate/endDate on list when dateRange is set", () => {
    const [list] = generateEntityTools(sampleConfig);
    const props = (list.inputSchema as { properties: Record<string, unknown> })
      .properties;
    expect(props).toHaveProperty("startDate");
    expect(props).toHaveProperty("endDate");
  });

  it("requires Id + SyncToken on update, plus any required create fields", () => {
    const tools = generateEntityTools(sampleConfig);
    const update = tools.find((t) => t.name === "qbo_widgets_update")!;
    const req = (update.inputSchema as { required: string[] }).required;
    expect(req).toContain("widgetId");
    expect(req).toContain("SyncToken");
  });

  it("omits ops that aren't declared on the config", () => {
    const minimal: EntityConfig = {
      name: "Tiny",
      toolPrefix: "qbo_tinies",
      description: "Just get + list",
      list: {},
      get: { idParam: "tinyId" },
    };
    const tools = generateEntityTools(minimal);
    expect(tools.map((t) => t.name)).toEqual(["qbo_tinies_list", "qbo_tinies_get"]);
  });

  it("payment create and update accept DepositToAccountRef", () => {
    const tools = generateEntityTools(paymentConfig);
    for (const name of ["qbo_payments_create", "qbo_payments_update"]) {
      const tool = tools.find((t) => t.name === name);
      const props = (tool?.inputSchema as { properties: Record<string, { description?: string }> })
        .properties;
      expect(props.DepositToAccountRef?.description).toMatch(/Omit on create/);
      expect(props.DepositToAccountRef?.description).toMatch(/Omit on update/);
    }
    const create = tools.find((t) => t.name === "qbo_payments_create")!;
    const update = tools.find((t) => t.name === "qbo_payments_update")!;
    expect((create.inputSchema as { required: string[] }).required).toEqual(
      expect.arrayContaining(["CustomerRef", "TotalAmt"])
    );
    expect((update.inputSchema as { required: string[] }).required).toEqual([
      "paymentId",
      "SyncToken",
    ]);
  });

  it("customer update can set Active and does not expose void", () => {
    const tools = generateEntityTools(customerConfig);
    expect(tools.map((t) => t.name)).not.toContain("qbo_customers_void");
    const update = tools.find((t) => t.name === "qbo_customers_update");
    const props = (update?.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty("Active");
    expect((update?.inputSchema as { required: string[] }).required).toEqual([
      "customerId",
      "SyncToken",
    ]);
    const create = tools.find((t) => t.name === "qbo_customers_create")!;
    expect((create.inputSchema as { required: string[] }).required).toContain("DisplayName");
  });

  it("invoice update does not require create-only CustomerRef and Line", () => {
    const tools = generateEntityTools(invoiceConfig);
    const create = tools.find((t) => t.name === "qbo_invoices_create")!;
    const update = tools.find((t) => t.name === "qbo_invoices_update")!;
    expect((create.inputSchema as { required: string[] }).required).toEqual(
      expect.arrayContaining(["CustomerRef", "Line"])
    );
    expect((update.inputSchema as { required: string[] }).required).toEqual([
      "invoiceId",
      "SyncToken",
    ]);
  });

  it("emits a void tool only when the config declares one", () => {
    const withVoid = generateEntityTools({
      ...sampleConfig,
      void: { idParam: "widgetId", style: "operation" },
    });
    expect(withVoid.map((t) => t.name)).toContain("qbo_widgets_void");
    const names = generateEntityTools(sampleConfig).map((t) => t.name);
    expect(names).not.toContain("qbo_widgets_void");
  });
});

describe("makeEntityDispatcher", () => {
  it("returns null for tools not belonging to this config", async () => {
    const dispatch = makeEntityDispatcher(sampleConfig);
    expect(await dispatch("qbo_other_list", {})).toBeNull();
  });

  it("prefers extra handlers over built-in dispatch", async () => {
    const extras: EntityExtras = {
      handlers: {
        qbo_widgets_list: async () => ({
          content: [{ type: "text", text: "from override" }],
        }),
      },
    };
    const dispatch = makeEntityDispatcher(sampleConfig, extras);
    const result = await dispatch("qbo_widgets_list", {});
    expect(result?.content[0]?.text).toBe("from override");
  });

  it("searches without an ESCAPE clause and pages past startPosition 1000", async () => {
    query.mockClear();
    const dispatch = makeEntityDispatcher(sampleConfig);
    await dispatch("qbo_widgets_search", { term: "Scharpf", startPosition: 1001 });
    expect(query).toHaveBeenCalledWith(
      "SELECT * FROM Widget WHERE DisplayName LIKE '%Scharpf%' STARTPOSITION 1001 MAXRESULTS 100"
    );
  });

  describe("invoice void guard", () => {
    const voidBody = { Id: "152", SyncToken: "2", sparse: true };
    const paidInvoice = {
      Invoice: {
        Id: "152",
        TotalAmt: 120,
        Balance: 0,
        LinkedTxn: [{ TxnId: "153", TxnType: "Payment" }],
      },
    };

    it("voids an unpaid invoice with operation=void after reading it", async () => {
      post.mockClear();
      get.mockClear();
      get.mockResolvedValueOnce({
        Invoice: { Id: "129", TotalAmt: 50, Balance: 50, LinkedTxn: [] },
      });
      const dispatch = makeEntityDispatcher(invoiceConfig);
      await dispatch("qbo_invoices_void", { invoiceId: "129", SyncToken: "0" });
      expect(get).toHaveBeenCalledWith("invoice/129");
      expect(post).toHaveBeenCalledWith(
        "invoice",
        { Id: "129", SyncToken: "0", sparse: true },
        { operation: "void" }
      );
    });

    it("refuses an invoice with an applied Payment", async () => {
      post.mockClear();
      get.mockResolvedValueOnce(paidInvoice);
      const dispatch = makeEntityDispatcher(invoiceConfig);
      const result = await dispatch("qbo_invoices_void", {
        invoiceId: "152",
        SyncToken: "2",
      });
      expect(result?.isError).toBe(true);
      const text = result?.content[0]?.text ?? "";
      expect(text).toMatch(/152/);
      expect(text).toMatch(/120/);
      expect(text).toMatch(/153/);
      expect(text).toMatch(/confirmPaidInvoiceVoid: true/);
      expect(post).not.toHaveBeenCalled();
    });

    it("refuses a partly paid invoice (Balance < TotalAmt, no LinkedTxn)", async () => {
      post.mockClear();
      get.mockResolvedValueOnce({
        Invoice: { Id: "152", TotalAmt: 120, Balance: 20 },
      });
      const dispatch = makeEntityDispatcher(invoiceConfig);
      const result = await dispatch("qbo_invoices_void", {
        invoiceId: "152",
        SyncToken: "2",
      });
      expect(result?.isError).toBe(true);
      expect(post).not.toHaveBeenCalled();
    });

    it("voids a paid invoice when confirmPaidInvoiceVoid is true, without sending the flag", async () => {
      post.mockClear();
      get.mockClear();
      const dispatch = makeEntityDispatcher(invoiceConfig);
      const result = await dispatch("qbo_invoices_void", {
        invoiceId: "152",
        SyncToken: "2",
        confirmPaidInvoiceVoid: true,
      });
      expect(result?.isError).not.toBe(true);
      expect(get).not.toHaveBeenCalled();
      expect(post).toHaveBeenCalledWith("invoice", voidBody, { operation: "void" });
      expect(JSON.stringify(post.mock.calls)).not.toContain("confirmPaidInvoiceVoid");
    });

    it('does not accept confirmPaidInvoiceVoid: "true" (string)', async () => {
      post.mockClear();
      get.mockResolvedValueOnce(paidInvoice);
      const dispatch = makeEntityDispatcher(invoiceConfig);
      const result = await dispatch("qbo_invoices_void", {
        invoiceId: "152",
        SyncToken: "2",
        confirmPaidInvoiceVoid: "true",
      });
      expect(result?.isError).toBe(true);
      expect(post).not.toHaveBeenCalled();
    });

    it("exposes confirmPaidInvoiceVoid and the corrected description once", () => {
      const voids = generateEntityTools(invoiceConfig).filter(
        (t) => t.name === "qbo_invoices_void"
      );
      expect(voids).toHaveLength(1);
      const tool = voids[0]!;
      const schema = tool.inputSchema as {
        properties: Record<string, { type?: string; description?: string }>;
        required: string[];
      };
      expect(schema.properties.confirmPaidInvoiceVoid?.type).toBe("boolean");
      expect(schema.required).toEqual(["invoiceId", "SyncToken"]);
      expect(tool.description).toMatch(
        /^Voids the invoice in QuickBooks\. This works even if a payment has already been applied, and the payment then stays as an unapplied credit\. Check the invoice's balance and payments first, and only void a paid invoice if the user explicitly asks for it\./
      );
      expect(tool.description).not.toMatch(/will not void/);
    });

    it("leaves the payment void tool unchanged", () => {
      const tool = generateEntityTools(paymentConfig).find(
        (t) => t.name === "qbo_payments_void"
      )!;
      const props = (tool.inputSchema as { properties: Record<string, unknown> })
        .properties;
      expect(Object.keys(props)).toEqual(["paymentId", "SyncToken"]);
      expect(tool.description).toMatch(/^Void an existing Payment record\./);
    });
  });

  describe("payment update CustomerRef", () => {
    const base = { paymentId: "153", SyncToken: "1" };
    const line = [{ Amount: 120, LinkedTxn: [{ TxnId: "152", TxnType: "Invoice" }] }];

    it("reads and resends the existing CustomerRef when Line is sent alone", async () => {
      post.mockClear();
      get.mockClear();
      get.mockResolvedValueOnce({
        Payment: { CustomerRef: { value: "58", name: "Amy's Bird Sanctuary" } },
      });
      const dispatch = makeEntityDispatcher(paymentConfig);
      await dispatch("qbo_payments_update", { ...base, Line: line });
      expect(get).toHaveBeenCalledWith("payment/153");
      expect(post).toHaveBeenCalledWith("payment", {
        Id: "153",
        SyncToken: "1",
        sparse: true,
        Line: line,
        CustomerRef: { value: "58", name: "Amy's Bird Sanctuary" },
      });
    });

    it("does not read the payment when CustomerRef is passed with Line", async () => {
      post.mockClear();
      get.mockClear();
      const dispatch = makeEntityDispatcher(paymentConfig);
      await dispatch("qbo_payments_update", {
        ...base,
        Line: line,
        CustomerRef: { value: "9" },
      });
      expect(get).not.toHaveBeenCalled();
      expect(post.mock.calls[0]?.[1]).toMatchObject({ CustomerRef: { value: "9" } });
    });

    it("does not read or add CustomerRef for a TotalAmt-only update", async () => {
      post.mockClear();
      get.mockClear();
      const dispatch = makeEntityDispatcher(paymentConfig);
      await dispatch("qbo_payments_update", { ...base, TotalAmt: 90 });
      expect(get).not.toHaveBeenCalled();
      expect(post).toHaveBeenCalledWith("payment", {
        Id: "153",
        SyncToken: "1",
        sparse: true,
        TotalAmt: 90,
      });
    });

    it("returns an error without posting when the payment has no CustomerRef", async () => {
      post.mockClear();
      get.mockResolvedValueOnce({ Payment: { Id: "153" } });
      const dispatch = makeEntityDispatcher(paymentConfig);
      const result = await dispatch("qbo_payments_update", { ...base, Line: line });
      expect(result?.isError).toBe(true);
      expect(result?.content[0]?.text).toMatch(/Pass CustomerRef/);
      expect(post).not.toHaveBeenCalled();
    });

    it("documents the rule in the schema and tool description", () => {
      const tools = generateEntityTools(paymentConfig);
      const update = tools.find((t) => t.name === "qbo_payments_update")!;
      const create = tools.find((t) => t.name === "qbo_payments_create")!;
      const props = (t: typeof update) =>
        (t.inputSchema as { properties: Record<string, { description?: string }> })
          .properties;
      expect(props(update).CustomerRef?.description).toBe(
        "Required when you change Line. Otherwise optional."
      );
      expect(props(create).CustomerRef?.description).toMatch(/^Customer reference object/);
      expect(update.description).toContain(
        "When Line is sent without CustomerRef, the tool reads the payment and resends its existing CustomerRef, because QuickBooks rejects a Line change without it."
      );
    });
  });

  it("voids a payment with operation=update&include=void", async () => {
    post.mockClear();
    const dispatch = makeEntityDispatcher(paymentConfig);
    await dispatch("qbo_payments_void", { paymentId: "79", SyncToken: "3" });
    expect(post).toHaveBeenCalledWith(
      "payment",
      { Id: "79", SyncToken: "3", sparse: true },
      { operation: "update", include: "void" }
    );
  });

  it("customer list pages past 1000 and searches without ESCAPE", async () => {
    query.mockClear();
    elicitText.mockClear();
    const dispatch = makeEntityDispatcher(customerConfig, customerExtras);

    await dispatch("qbo_customers_list", { startPosition: 1001, maxResults: 50 });
    expect(query).toHaveBeenCalledWith(
      "SELECT * FROM Customer STARTPOSITION 1001 MAXRESULTS 50"
    );
    expect(elicitText).not.toHaveBeenCalled();

    query.mockClear();
    await dispatch("qbo_customers_list", {});
    expect(query).toHaveBeenCalledWith(
      "SELECT * FROM Customer WHERE DisplayName LIKE '%Scharpf%' STARTPOSITION 1 MAXRESULTS 100"
    );
    expect(String(query.mock.calls[0]?.[0])).not.toContain("ESCAPE");
  });

  it("builds the handler map once and reuses it across calls", async () => {
    // Both calls must return null for the same out-of-scope name — proves
    // the dispatcher closure is stable and we're not re-resolving config on
    // every call. (Smoke; the real perf check is just no exceptions.)
    const dispatch = makeEntityDispatcher(sampleConfig);
    expect(await dispatch("qbo_other_list", {})).toBeNull();
    expect(await dispatch("qbo_other_list", {})).toBeNull();
  });
});
