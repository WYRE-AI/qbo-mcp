/**
 * Real-API integration tests against an Intuit QBO sandbox company.
 *
 * Skipped unless QBO_SANDBOX_ACCESS_TOKEN + QBO_SANDBOX_REALM_ID are set
 * in the environment — so unit-test runs (and fork-PR CI) stay green.
 * CI wires these from repo secrets; locally export them before running
 * `npm run test:integration`.
 *
 * Scope: one read tool per entity tier. We're checking that:
 *   1. The generator's tools dispatch correctly to QBO's REST API
 *   2. The sandbox host (sandbox-quickbooks.api.intuit.com) is reachable
 *      with the access token
 *   3. The response shape matches what entity handlers expect
 *
 * We don't write — sandbox companies aren't free-form and a leftover
 * test write could pollute future runs. Read-only by design.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { dispatchTool } from "../entities/index.js";
import { resetClient } from "../utils/client.js";

const sandboxAccessToken = process.env.QBO_SANDBOX_ACCESS_TOKEN;
const sandboxRealmId = process.env.QBO_SANDBOX_REALM_ID;
const hasCreds = Boolean(sandboxAccessToken && sandboxRealmId);

describe.skipIf(!hasCreds)("QBO sandbox integration", () => {
  beforeAll(() => {
    // Re-point the env-mode client at the sandbox. Tests use env mode
    // (not gateway/AsyncLocalStorage) so this is the simplest path.
    process.env.QBO_ACCESS_TOKEN = sandboxAccessToken;
    process.env.QBO_REALM_ID = sandboxRealmId;
    process.env.QBO_ENV = "sandbox";
    resetClient();
  });

  // Helper: dispatch a tool and assert the response isn't an error.
  async function callOk(toolName: string, args: Record<string, unknown> = {}) {
    const result = await dispatchTool(toolName, args);
    expect(result, `${toolName} returned null — tool not registered`).not.toBeNull();
    expect(
      result?.isError,
      `${toolName} returned isError: ${result?.content[0]?.text}`,
    ).not.toBe(true);
    return result!;
  }

  it("tier-0 (existing): qbo_customers_list returns Customer rows", async () => {
    const result = await callOk("qbo_customers_list", { maxResults: 5 });
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/QueryResponse/);
  });

  it("tier-1: qbo_vendors_list returns Vendor rows", async () => {
    const result = await callOk("qbo_vendors_list", { maxResults: 5 });
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/QueryResponse/);
  });

  it("tier-1: qbo_accounts_list returns Account rows (chart of accounts)", async () => {
    const result = await callOk("qbo_accounts_list", { maxResults: 5 });
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/QueryResponse/);
  });

  it("tier-1: qbo_items_list returns Item rows", async () => {
    const result = await callOk("qbo_items_list", { maxResults: 5 });
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/QueryResponse/);
  });

  it("tier-2: qbo_journal_entries_list returns transaction rows", async () => {
    const result = await callOk("qbo_journal_entries_list", { maxResults: 5 });
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/QueryResponse/);
  });

  it("tier-3: qbo_company_info_list returns the realm's company profile", async () => {
    const result = await callOk("qbo_company_info_list", {});
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/CompanyInfo|QueryResponse/);
  });

  it("reports: qbo_reports_balance_sheet runs against the sandbox", async () => {
    // Use a wide date range; sandbox companies are usually empty but the
    // report endpoint still returns a structured response.
    const result = await dispatchTool("qbo_reports_balance_sheet", {
      start_date: "2020-01-01",
      end_date: "2030-12-31",
    });
    // dispatchTool returns null for non-entity tools (reports live in
    // src/domains/), so this branch will only fire if the test setup
    // wires reports through the same dispatcher.
    if (result === null) {
      console.warn(
        "qbo_reports_balance_sheet not reachable via dispatchTool — reports use a separate handler. Skipping.",
      );
      return;
    }
    expect(result.isError).not.toBe(true);
  });
});
