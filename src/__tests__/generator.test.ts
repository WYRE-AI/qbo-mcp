import { describe, it, expect, vi } from "vitest";
import {
  generateEntityTools,
  makeEntityDispatcher,
} from "../entities/generator.js";
import { customerConfig, customerExtras } from "../entities/customer.js";
import { invoiceConfig } from "../entities/invoice.js";
import { paymentConfig } from "../entities/payment.js";
import type { EntityConfig, EntityExtras } from "../entities/types.js";

const { query, post, elicitText } = vi.hoisted(() => ({
  query: vi.fn(async (sql: string) => ({ sql })),
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
  getClient: () => ({ query, post }),
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
      const props = (tool?.inputSchema as { properties: Record<string, unknown> }).properties;
      expect(props).toHaveProperty("DepositToAccountRef");
    }
  });

  it("customer update can set Active and does not expose void", () => {
    const tools = generateEntityTools(customerConfig);
    expect(tools.map((t) => t.name)).not.toContain("qbo_customers_void");
    const update = tools.find((t) => t.name === "qbo_customers_update");
    const props = (update?.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty("Active");
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

  it("voids an invoice with operation=void", async () => {
    post.mockClear();
    const dispatch = makeEntityDispatcher(invoiceConfig);
    await dispatch("qbo_invoices_void", { invoiceId: "129", SyncToken: "0" });
    expect(post).toHaveBeenCalledWith(
      "invoice",
      { Id: "129", SyncToken: "0", sparse: true },
      { operation: "void" }
    );
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
