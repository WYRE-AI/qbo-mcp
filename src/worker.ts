/**
 * Cloudflare Workers entry point for the QuickBooks Online MCP Server.
 *
 * Serves the full MCP server over the Streamable HTTP transport using the SDK's
 * Web Standard transport (Request/Response), which runs natively on Workers.
 * It reuses the exact same `createMcpServer()` factory as the stdio / Node HTTP
 * entrypoints (see `mcp-server.ts`), so there is no second tool implementation
 * to maintain.
 *
 * Credentials are resolved per request and injected through the
 * `credentialStore` AsyncLocalStorage (supported on workerd with
 * `nodejs_compat`), so a single shared server instance can serve concurrent
 * requests with different credentials.
 *
 * 1. Gateway headers (when AUTH_MODE=gateway):
 *    - X-Qbo-Access-Token
 *    - X-Qbo-Realm-Id
 *    - X-Qbo-Environment (optional; production | sandbox, default production)
 * 2. Worker secrets / vars (env mode):
 *    - QBO_ACCESS_TOKEN
 *    - QBO_REALM_ID
 *    - QBO_ENV (optional)
 *
 * `tools/list` and `initialize` work without credentials; only `tools/call`
 * requires them.
 *
 * `/mcp` is fail-closed: it requires the gateway's X-Gateway-S2S header,
 * verified against the CONDUIT_S2S_SECRET Worker secret (same check as the
 * Node HTTP entry in index.ts). If the secret is not configured, `/mcp`
 * refuses every request. `/health` stays unauthenticated. There is no CORS:
 * the only caller is the gateway, never a browser.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  createMcpServer,
  resolveGatewayCredentials,
  credentialStore,
  parseEnvironment,
  type QboCredentials,
} from "./mcp-server.js";
import { verifyS2sHeader, S2S_HEADER } from "./s2s-verify.js";

export interface Env {
  QBO_ACCESS_TOKEN?: string;
  QBO_REALM_ID?: string;
  QBO_ENV?: string;
  AUTH_MODE?: string;
  LOG_LEVEL?: string;
  CONDUIT_S2S_SECRET?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Shallow, unauthenticated liveness probe.
    if (url.pathname === "/health" || url.pathname === "/healthz") {
      return json({ status: "ok" });
    }

    if (url.pathname === "/mcp") {
      // Fail closed: no configured secret means no requests, and a configured
      // secret is always enforced before credentials are read.
      const s2sSecret = (env.CONDUIT_S2S_SECRET ?? "").trim();
      if (!s2sSecret) {
        return json({ error: "S2S auth is not configured: CONDUIT_S2S_SECRET is empty." }, 503);
      }
      if (!verifyS2sHeader(request.headers.get(S2S_HEADER) ?? undefined, s2sSecret)) {
        return json(
          { error: "Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway." },
          401,
        );
      }

      const isGatewayMode = (env.AUTH_MODE ?? "env") === "gateway";

      let creds: QboCredentials | undefined;
      if (isGatewayMode) {
        const {
          creds: gwCreds,
          error,
          status,
        } = resolveGatewayCredentials(
          (name) => request.headers.get(name) ?? undefined,
        );
        if (error || !gwCreds) {
          return json(
            {
              error: status === 400 ? "Invalid X-Qbo-Environment header" : "Missing credentials",
              message: error,
              required: ["X-Qbo-Access-Token", "X-Qbo-Realm-Id"],
              optional: ["X-Qbo-Environment (production|sandbox, default production)"],
            },
            status ?? 401,
          );
        }
        creds = gwCreds;
      } else if (env.QBO_ACCESS_TOKEN && env.QBO_REALM_ID) {
        // env mode: build credentials from Worker secrets/vars if present.
        // (Absent creds are fine — tools/list still works, tools/call errors.)
        creds = {
          accessToken: env.QBO_ACCESS_TOKEN,
          realmId: env.QBO_REALM_ID,
          environment: parseEnvironment(env.QBO_ENV),
        };
      }

      // Fresh server + transport per request (stateless).
      const server = createMcpServer();
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);

      const run = async (): Promise<Response> => {
        try {
          return await transport.handleRequest(request);
        } finally {
          await transport.close();
          await server.close();
        }
      };

      // Inject per-request credentials via AsyncLocalStorage so getClient()
      // resolves them without mutating any global state.
      if (creds) {
        return credentialStore.run(creds, run);
      }
      return run();
    }

    return json({ error: "Not found", endpoints: ["/mcp", "/health"] }, 404);
  },
};
