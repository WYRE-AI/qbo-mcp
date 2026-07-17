/**
 * MCP Apps (SEP-1865) contract tests — mirrors the checks an MCP Apps host
 * performs to render the invoice card:
 *   1. the renderable tool advertises the UI resource via _meta
 *   2. the ui:// resource lists and reads back as profile=mcp-app HTML
 *   3. buildInvoiceCard normalizes a QBO invoice into the card payload the
 *      iframe renders from, best-effort (failures never break the tool result)
 */

import { describe, it, expect, vi } from "vitest";
import { listedTools } from "../mcp-server.js";
import { listResources, readResource } from "../resources.js";
import {
  buildInvoiceCard,
  attachInvoiceCard,
  applyBrandInjection,
  INVOICE_CARD_RESOURCE_URI,
  INVOICE_CARD_TOOL,
  MCP_APP_RESOURCE_MIME,
} from "../card.builder.js";
import { INVOICE_CARD_HTML } from "../generated/invoice-card-html.js";

/** A QBO GET /invoice/:id envelope the way the API actually returns it. */
function invoiceEnvelope(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    Invoice: {
      Id: "130",
      DocNumber: "1037",
      SyncToken: "0",
      TxnDate: "2026-07-01",
      // Default due date is in the future so the base status is Unpaid.
      DueDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
      TotalAmt: 362.07,
      Balance: 262.07,
      CustomerRef: { value: "24", name: "Sonnenschein Family Store" },
      CurrencyRef: { value: "USD", name: "United States Dollar" },
      BillEmail: { Address: "familystore@example.com" },
      CustomerMemo: { value: "Thank you for your business!" },
      EmailStatus: "NotSet",
      Line: [
        {
          Id: "1",
          LineNum: 1,
          Description: "Rock Fountain",
          Amount: 275,
          DetailType: "SalesItemLineDetail",
          SalesItemLineDetail: {
            ItemRef: { value: "5", name: "Rock Fountain" },
            UnitPrice: 275,
            Qty: 1,
          },
        },
        {
          Id: "2",
          LineNum: 2,
          Amount: 87.07,
          DetailType: "SalesItemLineDetail",
          SalesItemLineDetail: {
            ItemRef: { value: "6", name: "Sprinkler Heads" },
            UnitPrice: 43.535,
            Qty: 2,
          },
        },
        { Amount: 362.07, DetailType: "SubTotalLineDetail", SubTotalLineDetail: {} },
      ],
      ...overrides,
    },
    time: "2026-07-17T10:00:00.000-07:00",
  };
}

describe("MCP Apps invoice card", () => {
  describe("tool _meta advertisement", () => {
    it("qbo_invoices_get links the card via _meta", () => {
      const tool = listedTools.find((t) => t.name === INVOICE_CARD_TOOL);
      expect(tool).toBeDefined();
      // Canonical flat key (ext-apps RESOURCE_URI_META_KEY) …
      expect(tool?._meta?.["ui/resourceUri"]).toBe(INVOICE_CARD_RESOURCE_URI);
      // … and the nested form registerAppTool also emits.
      expect((tool?._meta?.ui as { resourceUri?: string })?.resourceUri).toBe(
        INVOICE_CARD_RESOURCE_URI,
      );
    });

    it("no other tools carry UI metadata", () => {
      const others = listedTools.filter(
        (t) => t._meta && t.name !== INVOICE_CARD_TOOL,
      );
      expect(others).toEqual([]);
    });
  });

  describe("ui:// resource", () => {
    it("is listed with the MCP Apps MIME type", () => {
      const card = listResources().find(
        (r) => r.uri === INVOICE_CARD_RESOURCE_URI,
      );
      expect(card?.mimeType).toBe(MCP_APP_RESOURCE_MIME);
    });

    it("reads back as profile=mcp-app HTML containing the card app", () => {
      const content = readResource(INVOICE_CARD_RESOURCE_URI);
      expect(content.mimeType).toBe(MCP_APP_RESOURCE_MIME);
      // No MCP_BRAND_* env set → the embedded HTML is served byte-identical.
      expect(content.text).toBe(INVOICE_CARD_HTML);
      expect(content.text).toContain("card__bar");
      // The vite build must have inlined the bridge script — a bare <script src>
      // would be unloadable from a resources/read HTML string.
      expect(content.text).not.toContain('src="./invoice-card.ts"');
    });

    it("carries the brand-injection marker exactly once", () => {
      expect(INVOICE_CARD_HTML.match(/BRAND_INJECT/g)).toHaveLength(1);
    });

    it("serves neutral defaults with no vendor identity", () => {
      const { text } = readResource(INVOICE_CARD_RESOURCE_URI);
      expect(text).not.toMatch(/WYRE/i);
      expect(text).not.toContain("00c9db"); // WYRE cyan
      expect(text).not.toContain("ede947"); // WYRE yellow
      expect(text).not.toContain("fonts.googleapis.com"); // no external fetches
    });

    it("injects MCP_BRAND_* env vars into the served HTML", () => {
      vi.stubEnv("MCP_BRAND_NAME", "Acme Accounting");
      vi.stubEnv("MCP_BRAND_PRIMARY_COLOR", "#ff0000");
      try {
        const { text } = readResource(INVOICE_CARD_RESOURCE_URI);
        expect(text).toContain(
          '<script>window.__BRAND__={"name":"Acme Accounting","primaryColor":"#ff0000"}</script>',
        );
        expect(text).not.toContain("BRAND_INJECT");
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("rejects unknown resource URIs", () => {
      expect(() => readResource("ui://qbo/nope.html")).toThrow(/Unknown resource/);
    });
  });

  describe("applyBrandInjection", () => {
    const html = INVOICE_CARD_HTML;

    it("replaces the marker with an inline window.__BRAND__ script", () => {
      const out = applyBrandInjection(html, {
        name: "Acme",
        primaryColor: "#123456",
      });
      expect(out).toContain(
        'window.__BRAND__={"name":"Acme","primaryColor":"#123456"}',
      );
      expect(out).not.toContain("BRAND_INJECT");
    });

    it("escapes < so brand values cannot break out of the script tag", () => {
      const out = applyBrandInjection(html, { name: "</script><script>alert(1)" });
      expect(out).not.toContain("</script><script>alert(1)");
      expect(out).toContain("\\u003c/script>\\u003cscript>alert(1)");
    });

    it("returns the HTML unchanged for an empty brand", () => {
      expect(applyBrandInjection(html, {})).toBe(html);
      expect(applyBrandInjection(html, { name: "" })).toBe(html);
    });
  });

  describe("buildInvoiceCard", () => {
    it("normalizes the QBO envelope into the flat card payload", () => {
      const card = buildInvoiceCard(invoiceEnvelope());
      expect(card).toMatchObject({
        id: "130",
        docNumber: "1037",
        status: "Unpaid",
        customer: "Sonnenschein Family Store",
        email: "familystore@example.com",
        txnDate: "2026-07-01",
        total: 362.07,
        balance: 262.07,
        currency: "USD",
        memo: "Thank you for your business!",
      });
      // SubTotal pseudo-lines are skipped; ItemRef.name backfills a missing
      // Description (both already label-resolved by QBO — no extra lookups).
      expect(card?.lines).toEqual([
        { description: "Rock Fountain", qty: 1, amount: 275 },
        { description: "Sprinkler Heads", qty: 2, amount: 87.07 },
      ]);
    });

    it("derives Paid from a zero balance (same semantics as the list filter)", () => {
      const card = buildInvoiceCard(invoiceEnvelope({ Balance: 0 }));
      expect(card?.status).toBe("Paid");
    });

    it("derives Overdue from a positive balance past the due date", () => {
      const card = buildInvoiceCard(invoiceEnvelope({ DueDate: "2020-01-01" }));
      expect(card?.status).toBe("Overdue");
    });

    it("caps line items and truncates long text so the payload stays small", () => {
      const manyLines = Array.from({ length: 12 }, (_, i) => ({
        Description: `Line ${i}`.padEnd(400, "x"),
        Amount: i,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: { Qty: 1 },
      }));
      const card = buildInvoiceCard(
        invoiceEnvelope({ Line: manyLines, CustomerMemo: { value: "y".repeat(400) } }),
      );
      expect(card?.lines).toHaveLength(8);
      expect(card?.lines[0].description).toHaveLength(300);
      expect(card?.memo).toHaveLength(300);
    });

    it("returns null for payloads that are not an invoice", () => {
      expect(buildInvoiceCard(null)).toBeNull();
      expect(buildInvoiceCard({})).toBeNull();
      expect(buildInvoiceCard({ Invoice: { Id: "1" } })).toBeNull(); // no TotalAmt
      expect(buildInvoiceCard({ QueryResponse: {} })).toBeNull();
    });
  });

  describe("attachInvoiceCard", () => {
    it("attaches _card without touching the model-visible payload", () => {
      const envelope = invoiceEnvelope();
      const result = attachInvoiceCard(envelope) as Record<string, unknown>;
      expect(result.Invoice).toBe(envelope.Invoice);
      expect(result.time).toBe(envelope.time);
      expect(result._card).toMatchObject({ id: "130", status: "Unpaid" });
    });

    it("returns non-invoice results unchanged", () => {
      const notAnInvoice = { Fault: { Error: [{ Message: "not found" }] } };
      expect(attachInvoiceCard(notAnInvoice)).toBe(notAnInvoice);
    });

    it("never throws, even on hostile payloads (card is best-effort)", () => {
      const bomb = {
        get Invoice(): never {
          throw new Error("boom");
        },
      };
      expect(attachInvoiceCard(bomb)).toBe(bomb);
    });
  });
});
