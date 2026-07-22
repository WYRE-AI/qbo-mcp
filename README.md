# QuickBooks Online MCP Server

Model Context Protocol (MCP) server for the [QuickBooks Online Accounting API](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account). Exposes 130+ tools across 22 QBO entities plus 10 financial reports for Claude and other MCP-compatible clients.

## Features

- **Interactive invoice card (MCP Apps, SEP-1865)**: `qbo_invoices_get` renders as a read-only interactive card in MCP Apps hosts (Claude Desktop/web) — customer, status, dates, line items, totals — neutral by default, brandable via `window.__BRAND__` injection or `MCP_BRAND_*` env vars. Non-App hosts see the same JSON payload (plus a `_card` field).

## One-Click Deployment

[![Deploy to DO](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/wyre-technology/qbo-mcp/tree/main)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wyre-technology/qbo-mcp)

> **Note on registry auth:** This server depends only on public npm packages, so the Cloudflare and DigitalOcean cloud builders install its dependencies anonymously — no token is required for one-click deploy. (If a future release adds a private `@wyre-technology/*` dependency, you would supply a GitHub PAT with `read:packages` as a build variable — `NODE_AUTH_TOKEN` for Cloudflare Workers, a build-time `GITHUB_TOKEN` secret for DigitalOcean.)
>
> **Installing the published package:** The released package is published to the [GitHub Packages](https://github.com/wyre-technology/qbo-mcp/pkgs/npm/qbo-mcp) npm registry, which requires authentication on every install (even for public packages). To install it, authenticate npm to `npm.pkg.github.com` with a GitHub PAT that has `read:packages`:
>
> ```bash
> export NODE_AUTH_TOKEN=$(gh auth token)
> npm install @wyre-technology/qbo-mcp
> ```

## Quick Start

### Prerequisites

- Node.js >= 20
- QuickBooks Online OAuth2 app credentials (requires an Intuit developer account)

### Install and Build

```bash
npm install
npm run build
```

### Run (stdio mode)

```bash
QBO_ACCESS_TOKEN=your-access-token QBO_REALM_ID=your-realm-id npm start
```

### Run (HTTP mode)

```bash
MCP_TRANSPORT=http QBO_ACCESS_TOKEN=your-access-token QBO_REALM_ID=your-realm-id npm start
```

The server listens on `http://0.0.0.0:8080/mcp` by default.

### Docker

```bash
docker build -t qbo-mcp .
docker run -p 8080:8080 \
  -e MCP_TRANSPORT=http \
  -e QBO_ACCESS_TOKEN=your-access-token \
  -e QBO_REALM_ID=your-realm-id \
  qbo-mcp
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `QBO_ACCESS_TOKEN` | Yes (env mode) | — | QuickBooks Online OAuth2 access token |
| `QBO_REALM_ID` | Yes (env mode) | — | QuickBooks Online company (realm) ID |
| `QBO_ENV` | No | `production` | API environment: `production` or `sandbox` |
| `MCP_TRANSPORT` | No | `stdio` | Transport type: `stdio` or `http` |
| `MCP_HTTP_PORT` | No | `8080` | HTTP server port |
| `MCP_HTTP_HOST` | No | `0.0.0.0` | HTTP server bind address |
| `AUTH_MODE` | No | `env` | Auth mode: `env` or `gateway` |
| `MCP_BRAND_NAME` | No | — | Brand name shown on the MCP Apps invoice card (card is neutral when unset) |
| `MCP_BRAND_LOGO_URL` | No | — | Logo URL for the invoice card |
| `MCP_BRAND_PRIMARY_COLOR` | No | `#2563eb` | Invoice card primary color |
| `MCP_BRAND_ACCENT_COLOR` | No | `#e5e7eb` | Invoice card accent color |
| `MCP_BRAND_BG` | No | `#ffffff` | Invoice card background color |
| `MCP_BRAND_TEXT` | No | `#333333` | Invoice card text color |

## Authentication

The server does not handle the OAuth flow — it consumes a pre-obtained access token. Two modes:

**env mode (default).** Token comes from `QBO_ACCESS_TOKEN`. Single tenant.

**gateway mode.** Token comes from per-request HTTP headers, isolated through `AsyncLocalStorage` so concurrent requests never share credentials. Set `AUTH_MODE=gateway` and send:

| Header | Required | Description |
|---|---|---|
| `X-Qbo-Access-Token` | Yes | OAuth2 access token |
| `X-Qbo-Realm-Id` | Yes | Company (realm) ID |
| `X-Qbo-Environment` | No | `production` or `sandbox` (defaults to `production`) |

When QBO rejects the access token, the server returns an MCP error whose text begins with the literal prefix `QBO_UNAUTHORIZED:`. The intended contract is that the gateway detects this prefix, refreshes the OAuth token, and retries the request.

## Sandbox Testing

Set `QBO_ENV=sandbox` (env mode) or `X-Qbo-Environment: sandbox` (gateway mode) to target Intuit's sandbox API at `https://sandbox-quickbooks.api.intuit.com` instead of production. Unrecognized values fail loudly (no silent fallback to production).

## Available Tools

Tools are organized by domain. Call `qbo_navigate` with a domain name (e.g. `customers`, `vendors`, `bills`) to discover the tools in that domain. All tools are always callable — navigation is a discovery aid, not a prerequisite.

### Entities (config-driven, 116 tools across 22 entities)

Each entity exposes some subset of `list`, `get`, `create`, `update`, `search`. Transactional entities support `startDate`/`endDate` filtering on the list operation. Updates are sparse and require the current `SyncToken` from a prior get.

**Sales workflow**
- `qbo_customers_*` — list, get, create, search
- `qbo_invoices_*` — list (Paid/Unpaid/Overdue status filter), get, create, send
- `qbo_estimates_*` — list, get, create, update
- `qbo_sales_receipts_*` — list, get, create, update
- `qbo_credit_memos_*` — list, get, create, update
- `qbo_refund_receipts_*` — list, get, create, update
- `qbo_payments_*` — list, get, create

**Purchase workflow**
- `qbo_vendors_*` — list, get, create, update, search
- `qbo_bills_*` — list, get, create, update, search
- `qbo_bill_payments_*` — list, get, create, update
- `qbo_vendor_credits_*` — list, get, create, update
- `qbo_purchases_*` — list, get, create, update (point-of-sale expenses)
- `qbo_purchase_orders_*` — list, get, create, update

**Bank & money movement**
- `qbo_deposits_*` — list, get, create, update
- `qbo_transfers_*` — list, get, create, update
- `qbo_journal_entries_*` — list, get, create, update (balanced debit/credit)

**Products & accounts**
- `qbo_items_*` — list, get, create, update, search (products and services)
- `qbo_accounts_*` — list, get, create, update, search (chart of accounts)

**Classification & terms**
- `qbo_classes_*` — list, get, create, update, search
- `qbo_departments_*` — list, get, create, update, search
- `qbo_terms_*` — list, get, create, update, search (Net 30, etc.)
- `qbo_payment_methods_*` — list, get, create, update, search

**Tax & company**
- `qbo_tax_codes_*` — list, get, search (read-only)
- `qbo_tax_rates_*` — list, get, search (read-only)
- `qbo_company_info_*` — list, get (read-only singleton)

**People & time**
- `qbo_employees_*` — list, get, create, update, search
- `qbo_time_activities_*` — list, get, create, update (billable time)

**Attachments**
- `qbo_attachables_*` — list, get, create, update (metadata only; file upload uses a separate QBO endpoint)

### Reports (10 tools)

- `qbo_reports_profit_and_loss`
- `qbo_reports_balance_sheet`
- `qbo_reports_cash_flow`
- `qbo_reports_trial_balance`
- `qbo_reports_general_ledger`
- `qbo_reports_aged_receivables`
- `qbo_reports_aged_payables`
- `qbo_reports_customer_sales`
- `qbo_reports_customer_balance`
- `qbo_reports_vendor_expenses`

### Legacy expense tools (backwards compatibility)

`qbo_expenses_list_purchases`, `qbo_expenses_get_purchase`, `qbo_expenses_list_bills`, `qbo_expenses_get_bill` remain available. New work should use the dedicated `qbo_purchases_*` and `qbo_bills_*` tool families, which add create/update/search.

## Testing

```bash
npm test                   # unit suite — fast, no credentials needed
npm run test:integration   # hits a real QBO sandbox; skipped without creds
```

The integration suite calls one read tool per entity tier (customers, vendors, accounts, items, journal entries, company info) against Intuit's sandbox API. It only runs when both `QBO_SANDBOX_ACCESS_TOKEN` and `QBO_SANDBOX_REALM_ID` are present in the environment. CI wires these from the matching repo secrets and skips the job (with a clear notice) when they're absent — so dependabot/fork PRs don't fail.

## License

Apache-2.0
