# QuickBooks Online MCP Server

Model Context Protocol (MCP) server for the [QuickBooks Online Accounting API](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account). Exposes 130+ tools across 22 QBO entities plus 10 financial reports for Claude and other MCP-compatible clients.

## Features

- **Interactive invoice card (MCP Apps, SEP-1865)**: `qbo_invoices_get` renders as a read-only interactive card in MCP Apps hosts (Claude Desktop/web) — customer, status, dates, line items, totals — neutral by default, brandable via `window.__BRAND__` injection or `MCP_BRAND_*` env vars. Non-App hosts see the same JSON payload (plus a `_card` field).

## One-Click Deployment

[![Deploy to DO](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/WYRE-AI/qbo-mcp/tree/main)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/WYRE-AI/qbo-mcp)

> **Note on registry auth:** This server depends only on public npm packages, so the Cloudflare and DigitalOcean cloud builders install its dependencies anonymously — no token is required for one-click deploy. (If a future release adds a private `@wyre-ai/*` dependency, you would supply a GitHub PAT with `read:packages` as a build variable — `NODE_AUTH_TOKEN` for Cloudflare Workers, a build-time `GITHUB_TOKEN` secret for DigitalOcean.)
>
> **Installing the published package:** The released package is published to the [GitHub Packages](https://github.com/WYRE-AI/qbo-mcp/pkgs/npm/qbo-mcp) npm registry, which requires authentication on every install (even for public packages). To install it, authenticate npm to `npm.pkg.github.com` with a GitHub PAT that has `read:packages`:
>
> ```bash
> export NODE_AUTH_TOKEN=$(gh auth token)
> npm install @wyre-ai/qbo-mcp
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

HTTP refuses to start until `CONDUIT_S2S_SECRET` is set. The listener defaults to `127.0.0.1:8080`.

```bash
CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
  MCP_TRANSPORT=http \
  QBO_ACCESS_TOKEN=your-access-token \
  QBO_REALM_ID=your-realm-id \
  npm start
```

Local HTTP without a secret is development-only. It binds `127.0.0.1` only and logs a warning. A non-loopback `MCP_HTTP_HOST` is ignored and the override is logged:

```bash
MCP_TRANSPORT=http MCP_ALLOW_INSECURE_DEV=1 \
  QBO_ACCESS_TOKEN=your-access-token \
  QBO_REALM_ID=your-realm-id \
  npm start
```

### Docker

The image listens on `0.0.0.0` inside the container (`MCP_HTTP_HOST`) and defaults to `AUTH_MODE=gateway`. Publish the port on loopback and pass a real S2S secret. In gateway mode the access token and realm id arrive on each request as `X-Qbo-Access-Token` and `X-Qbo-Realm-Id`; they are not read from the environment.

```bash
# Generate the secret first: openssl rand -hex 32
docker build -t qbo-mcp .
docker run \
  -e CONDUIT_S2S_SECRET \
  -p 127.0.0.1:8080:8080 \
  qbo-mcp
```

Compose refuses to start when `CONDUIT_S2S_SECRET` is unset, defaults `AUTH_MODE` to `gateway`, does not inject `QBO_ACCESS_TOKEN` or `QBO_REALM_ID`, and publishes `127.0.0.1:8080:8080`:

```bash
CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" docker compose up
```

Single-tenant HTTP (`AUTH_MODE=env`) still requires the S2S secret, then uses `QBO_ACCESS_TOKEN` and `QBO_REALM_ID`:

```bash
docker run \
  -e CONDUIT_S2S_SECRET \
  -e AUTH_MODE=env \
  -e QBO_ACCESS_TOKEN=your-access-token \
  -e QBO_REALM_ID=your-realm-id \
  -p 127.0.0.1:8080:8080 \
  qbo-mcp
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `QBO_ACCESS_TOKEN` | For stdio and `AUTH_MODE=env` | — | QuickBooks Online OAuth2 access token. The Compose gateway service does not load this variable. |
| `QBO_REALM_ID` | For stdio and `AUTH_MODE=env` | — | QuickBooks Online company (realm) ID. The Compose gateway service does not load this variable. |
| `QBO_ENV` | No | `production` | API environment: `production` or `sandbox` |
| `QBO_CREDENTIALS_FILE` | No | — | Path to a dotenv-format file re-read on every request; its `QBO_ACCESS_TOKEN` / `QBO_REALM_ID` / `QBO_ENV` override the environment variables (see [Token rotation](#token-rotation-env-mode)). Not used by the gateway Compose service. |
| `MCP_TRANSPORT` | No | `stdio` | Transport type: `stdio` or `http` |
| `MCP_HTTP_PORT` | No | `8080` | HTTP server port |
| `MCP_HTTP_HOST` | No | `127.0.0.1` | Bind address when `MCP_TRANSPORT=http`. A configured `CONDUIT_S2S_SECRET` honors this value. The container image sets `0.0.0.0`. Without a secret, `MCP_ALLOW_INSECURE_DEV=1` binds `127.0.0.1` only. |
| `AUTH_MODE` | No | `env` (image and Compose: `gateway`) | `gateway` or `env`. Gateway mode requires `X-Qbo-Access-Token` and `X-Qbo-Realm-Id` on each `/mcp` request and never falls back to `QBO_*`. `env` uses those variables only after S2S auth succeeds. |
| `CONDUIT_S2S_SECRET` | Yes for HTTP | — | Service-to-service secret. Generate with `openssl rand -hex 32`. The HTTP server logs an error and exits non-zero when this is empty or a known placeholder (`changeme`, `your-s2s-secret`, `secret`, `placeholder`, and similar public examples). Compose will not start without it. Never commit a real value. The value is never logged. |
| `MCP_ALLOW_INSECURE_DEV` | No | — | Set to exactly `1` only for local development to start HTTP without `CONDUIT_S2S_SECRET`. The process logs a warning, does not enforce `X-Gateway-S2S`, and forces the listener onto `127.0.0.1` even if `MCP_HTTP_HOST` is a wider address. A known placeholder secret is still refused. |
| `MCP_BRAND_NAME` | No | — | Brand name shown on the MCP Apps invoice card (card is neutral when unset) |
| `MCP_BRAND_LOGO_URL` | No | — | Logo URL for the invoice card |
| `MCP_BRAND_PRIMARY_COLOR` | No | `#2563eb` | Invoice card primary color |
| `MCP_BRAND_ACCENT_COLOR` | No | `#e5e7eb` | Invoice card accent color |
| `MCP_BRAND_BG` | No | `#ffffff` | Invoice card background color |
| `MCP_BRAND_TEXT` | No | `#333333` | Invoice card text color |

## Authentication

The server does not handle the OAuth flow — it consumes a pre-obtained access token. Two modes:

**env mode (process default).** Token comes from `QBO_ACCESS_TOKEN` (or from the file named by `QBO_CREDENTIALS_FILE`, which wins when both are set). Single tenant. The Docker image and Compose file default to gateway mode instead.

**gateway mode.** Token comes from per-request HTTP headers, isolated through `AsyncLocalStorage` so concurrent requests never share credentials. Set `AUTH_MODE=gateway` and send `X-Qbo-Access-Token` and `X-Qbo-Realm-Id`. A request missing either header gets HTTP 401 and does not fall back to `QBO_ACCESS_TOKEN` / `QBO_REALM_ID` in the process environment.

| Header | Required | Description |
|---|---|---|
| `X-Qbo-Access-Token` | Yes | OAuth2 access token |
| `X-Qbo-Realm-Id` | Yes | Company (realm) ID |
| `X-Qbo-Environment` | No | `production` or `sandbox` (defaults to `production`) |

`/health` stays unauthenticated and does not read credentials. The stdio transport does not use `CONDUIT_S2S_SECRET`.

### HTTP authentication

With `MCP_TRANSPORT=http` and `CONDUIT_S2S_SECRET` set, every `/mcp` request must include `X-Gateway-S2S`. The check is `verifyS2sHeader` in [`src/s2s-verify.ts`](src/s2s-verify.ts): the header value is `t=<unix seconds>,v1=<hex>`, where the hex is HMAC-SHA256 of the literal string `t=<unix seconds>` keyed with `CONDUIT_S2S_SECRET` (64 lowercase hex characters). The timestamp must be within 300 seconds of the server clock. A missing or invalid header returns HTTP 401 before vendor credentials are read.

```bash
TS=$(date +%s)
SIG=$(printf 't=%s' "$TS" | openssl dgst -sha256 -hmac "$CONDUIT_S2S_SECRET" -hex | awk '{print $NF}')
curl -sS http://127.0.0.1:8080/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "X-Gateway-S2S: t=${TS},v1=${SIG}" \
  -H "X-Qbo-Access-Token: $QBO_ACCESS_TOKEN" \
  -H "X-Qbo-Realm-Id: $QBO_REALM_ID" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

In `AUTH_MODE=gateway`, those `X-Qbo-*` headers are the only credential source for the request. With `AUTH_MODE=env`, the signed request uses `QBO_ACCESS_TOKEN` and `QBO_REALM_ID` from the environment when the headers are absent.

When QBO rejects the access token, the server returns an MCP error whose text begins with the literal prefix `QBO_UNAUTHORIZED:`. The intended contract is that the gateway detects this prefix, refreshes the OAuth token, and retries the request.

### Token rotation (env mode)

QBO access tokens expire after ~60 minutes, so env-mode deployments typically rotate them with a cron job. **A rotated token in a Docker `env_file` never reaches a running container**: Docker injects `env_file` only at container *creation*, so `docker restart` keeps the old environment and the refresh loop silently becomes a no-op until calls start failing with `QBO_UNAUTHORIZED` / `Token revoked` (#63).

Set `QBO_CREDENTIALS_FILE` to skip environment reinjection entirely. The server re-reads the file on every request, so a rotation takes effect immediately — no restart or recreate at all:

```yaml
# Single-tenant HTTP. This is separate from the gateway Compose service,
# which does not set QBO_* credentials.
services:
  qbo-mcp:
    image: ghcr.io/wyre-ai/qbo-mcp
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      MCP_TRANSPORT: http
      AUTH_MODE: env
      MCP_HTTP_HOST: 0.0.0.0
      CONDUIT_S2S_SECRET: ${CONDUIT_S2S_SECRET:?set CONDUIT_S2S_SECRET}
      QBO_CREDENTIALS_FILE: /secrets/qbo.env
    volumes:
      - ./secrets:/secrets:ro   # mount the DIRECTORY, not the file
```

Your refresh job then just rewrites `./secrets/qbo.env` (dotenv format: `QBO_ACCESS_TOKEN=...`, optionally `QBO_REALM_ID=...` and `QBO_ENV=...`) and is done — drop the `docker restart` from the script. Mount the containing directory rather than the file itself: tools like `sed -i` replace the file's inode, and a single-file bind mount would keep pointing at the old one. If the file is missing or unreadable, tool calls fail loudly instead of silently falling back to a stale environment token.

If you'd rather keep plain `env_file` injection, the rotation script must recreate the container — `docker compose up -d --force-recreate` — a `docker restart` is never enough.

## Sandbox Testing

Set `QBO_ENV=sandbox` (env mode) or `X-Qbo-Environment: sandbox` (gateway mode) to target Intuit's sandbox API at `https://sandbox-quickbooks.api.intuit.com` instead of production. Unrecognized values fail loudly (no silent fallback to production).

## Available Tools

Tools are organized by domain. Call `qbo_navigate` with a domain name (e.g. `customers`, `vendors`, `bills`) to discover the tools in that domain. All tools are always callable — navigation is a discovery aid, not a prerequisite.

### Entities (config-driven, 122 tools across 22 entities)

Each entity exposes some subset of `list`, `get`, `create`, `update`, `void`, `search`. Transactional entities support `startDate`/`endDate` filtering on the list operation. Updates are sparse and require the current `SyncToken` from a prior get. Void is exposed only where the QBO Accounting API supports it (Invoice uses `?operation=void`; Payment uses `?operation=update&include=void`). Customer has no void or delete — set `Active` to false on update to deactivate.

QBO voids an invoice even when a payment is applied; the payment then stays as an unapplied credit. `qbo_invoices_void` therefore reads the invoice first and refuses to void a paid or partly paid invoice unless called with `confirmPaidInvoiceVoid: true` (only pass it when the user explicitly asked). On `qbo_payments_update`, `CustomerRef` is required whenever `Line` changes (QBO rejects it otherwise); if you omit it, the tool reads the payment and resends its existing `CustomerRef`.

**Sales workflow**
- `qbo_customers_*` — list, get, create, update, search (no void; deactivate with `Active: false`)
- `qbo_invoices_*` — list (Paid/Unpaid/Overdue status filter), get, create, update, void, send
- `qbo_estimates_*` — list, get, create, update
- `qbo_sales_receipts_*` — list, get, create, update
- `qbo_credit_memos_*` — list, get, create, update
- `qbo_refund_receipts_*` — list, get, create, update
- `qbo_payments_*` — list, get, create, update, void

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
