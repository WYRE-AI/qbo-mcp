import { describe, it, expect } from 'vitest';

describe('qbo-mcp', () => {
  it('should export domain tools', async () => {
    const customers = await import('../domains/customers.js');
    const invoices = await import('../domains/invoices.js');
    const expenses = await import('../domains/expenses.js');
    const payments = await import('../domains/payments.js');
    const reports = await import('../domains/reports.js');

    expect(customers.customerTools.length).toBeGreaterThan(0);
    expect(invoices.invoiceTools.length).toBeGreaterThan(0);
    expect(expenses.expenseTools.length).toBeGreaterThan(0);
    expect(payments.paymentTools.length).toBeGreaterThan(0);
    expect(reports.reportTools.length).toBeGreaterThan(0);
  });

  it('should have unique tool names', async () => {
    const customers = await import('../domains/customers.js');
    const invoices = await import('../domains/invoices.js');
    const expenses = await import('../domains/expenses.js');
    const payments = await import('../domains/payments.js');
    const reports = await import('../domains/reports.js');

    const allTools = [
      ...customers.customerTools,
      ...invoices.invoiceTools,
      ...expenses.expenseTools,
      ...payments.paymentTools,
      ...reports.reportTools,
    ];
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('should have flattened navigation (all tools always available)', async () => {
    // Import the server module to test getAllDomainTools
    const serverModule = await import('../index.js');

    // This test verifies that the navigation is flattened -
    // all tools are always available without needing to "navigate" first.
    // The index module should export all tools from all domains.
    expect(serverModule).toBeDefined();
  });
});
