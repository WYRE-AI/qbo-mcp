import { describe, it, expect } from "vitest";

describe("qbo-mcp", () => {
  it("exposes tools from every registered domain", async () => {
    const { allEntityTools } = await import("../entities/index.js");
    const { expenseTools } = await import("../domains/expenses.js");
    const { reportTools } = await import("../domains/reports.js");

    expect(allEntityTools.length).toBeGreaterThan(0);
    expect(expenseTools.length).toBeGreaterThan(0);
    expect(reportTools.length).toBeGreaterThan(0);
  });

  it("has unique tool names across the merged surface", async () => {
    const { allEntityTools } = await import("../entities/index.js");
    const { expenseTools } = await import("../domains/expenses.js");
    const { reportTools } = await import("../domains/reports.js");

    const names = [
      ...allEntityTools.map((t) => t.name),
      ...expenseTools.map((t) => t.name),
      ...reportTools.map((t) => t.name),
    ];
    expect(new Set(names).size).toBe(names.length);
  });

  it("preserves the pre-migration tool names for Customer/Invoice/Payment", async () => {
    // Backwards compatibility: callers (gateway, claude.ai connectors) have
    // these names cached; renames here would break them.
    const { allEntityTools } = await import("../entities/index.js");
    const names = new Set(allEntityTools.map((t) => t.name));
    for (const expected of [
      "qbo_customers_list",
      "qbo_customers_get",
      "qbo_customers_create",
      "qbo_customers_search",
      "qbo_invoices_list",
      "qbo_invoices_get",
      "qbo_invoices_create",
      "qbo_invoices_send",
      "qbo_payments_list",
      "qbo_payments_get",
      "qbo_payments_create",
    ]) {
      expect(names, `missing tool ${expected}`).toContain(expected);
    }
  });
});
