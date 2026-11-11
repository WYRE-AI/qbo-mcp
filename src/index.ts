#!/usr/bin/env node
/**
 * QuickBooks Online MCP Server
 *
 * This MCP server provides tools for interacting with the QuickBooks Online API.
 * All tools are listed upfront so they work with every MCP client, including
 * remote connectors (claude.ai, mcp-remote) that do not support dynamic
 * tool-list changes. A helper `qbo_navigate` tool provides domain
 * discovery and guidance.
 *
 * Supports both stdio and HTTP (StreamableHTTP) transports.
 * Authentication: Set QBO_ACCESS_TOKEN and QBO_REALM_ID environment variables (env mode)
 *                 or pass X-Qbo-Access-Token and X-Qbo-Realm-Id headers (gateway mode).
 *                 Gateway mode never falls back to QBO_* env credentials.
 * HTTP transport refuses to start unless CONDUIT_S2S_SECRET is a real
 * secret. MCP_ALLOW_INSECURE_DEV=1 is a local-only escape hatch: it logs
 * a warning and forces the listener onto 127.0.0.1. Known placeholder
 * secrets are rejected even with that flag. /health stays unauthenticated
 * and does not read credentials. stdio does not use S2S auth.
 * Rate Limit: 500 requests/minute
 */

import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { credentialStore } from "./utils/client.js";
import {
  createMcpServer,
  resolveGatewayCredentials,
} from "./mcp-server.js";
import { verifyS2sHeader, S2S_HEADER } from "./s2s-verify.js";

/**
 * Public example values. A copied placeholder must not verify as a real
 * secret. Matched case-insensitively after trim. Never log the value.
 */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  "replace-with-a-real-secret",
  "your-s2s-secret",
  "your-secret",
  "changeme",
  "change-me",
  "placeholder",
  "secret",
  "example",
  "replace-me",
  "s2s-secret",
]);

const LOOPBACK_HOST = "127.0.0.1";

const MISSING_S2S_SECRET_ERROR =
  "Refusing to start HTTP transport: CONDUIT_S2S_SECRET is empty. " +
  "Set CONDUIT_S2S_SECRET to the gateway-provisioned secret (openssl rand -hex 32), " +
  "or set MCP_ALLOW_INSECURE_DEV=1 for local development only.";

const PLACEHOLDER_S2S_SECRET_ERROR =
  "Refusing to start HTTP transport: CONDUIT_S2S_SECRET is a known placeholder. " +
  "Generate a secret with openssl rand -hex 32 and set CONDUIT_S2S_SECRET to that value.";

const INSECURE_DEV_WARNING =
  "SECURITY WARNING: CONDUIT_S2S_SECRET is empty and MCP_ALLOW_INSECURE_DEV=1. " +
  "HTTP /mcp is not enforcing X-Gateway-S2S and is bound to 127.0.0.1 only. " +
  "Do not use this outside local development.";

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[(.+)\]$/, "$1");
  if (normalized === "localhost" || normalized === "::1") return true;
  const bare = normalized.startsWith("::ffff:")
    ? normalized.slice("::ffff:".length)
    : normalized;
  const parts = bare.split(".");
  if (parts.length !== 4) return false;
  if (parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
    return false;
  }
  return parts[0] === "127";
}

/**
 * Secret for X-Gateway-S2S on /mcp. Read at HTTP startup, not module load.
 * Empty is fail-closed unless MCP_ALLOW_INSECURE_DEV=1. A known placeholder
 * always refuses to start. The secret value is never written to logs.
 */
function resolveHttpS2sSecret(): { secret: string; insecureDev: boolean } {
  const raw = (process.env.CONDUIT_S2S_SECRET ?? "").trim();
  if (KNOWN_PLACEHOLDER_SECRETS.has(raw.toLowerCase())) {
    console.error(PLACEHOLDER_S2S_SECRET_ERROR);
    process.exit(1);
  }
  if (raw) return { secret: raw, insecureDev: false };
  if (process.env.MCP_ALLOW_INSECURE_DEV === "1") {
    console.error(INSECURE_DEV_WARNING);
    return { secret: "", insecureDev: true };
  }
  console.error(MISSING_S2S_SECRET_ERROR);
  process.exit(1);
}

/**
 * With a real secret, honor MCP_HTTP_HOST (default 127.0.0.1 when unset).
 * Without a secret the insecure-dev bypass forces 127.0.0.1, including when
 * MCP_HTTP_HOST is a wider address such as 0.0.0.0.
 */
function resolveBindHost(hasRealSecret: boolean): string {
  const configured = (process.env.MCP_HTTP_HOST ?? "").trim();
  if (hasRealSecret) return configured || LOOPBACK_HOST;
  if (configured && !isLoopbackHost(configured)) {
    console.error(
      `WARNING: MCP_HTTP_HOST=${configured} is not a loopback address. ` +
        "MCP_ALLOW_INSECURE_DEV=1 without CONDUIT_S2S_SECRET forces the listener to 127.0.0.1 only."
    );
  }
  return LOOPBACK_HOST;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Transport and auth configuration types
 */
type TransportType = "stdio" | "http";
type AuthMode = "env" | "gateway";

/**
 * Start the server with stdio transport (default).
 *
 * stdio is inherently single-client, so one shared server is correct here.
 */
async function startStdioTransport(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("QBO MCP server running on stdio");
}

/**
 * Handle a single MCP request over HTTP with a fresh Server + Transport.
 *
 * qbo-mcp holds no per-session state — every request carries its own
 * credentials (X-Qbo-* headers in gateway mode, env vars otherwise) and is
 * handled independently, so a stateless per-request server + transport is the
 * correct model (and mirrors the Cloudflare Worker entrypoint in worker.ts).
 *
 * A single shared transport reused across requests breaks under
 * @modelcontextprotocol/sdk >= 1.29: the first `initialize` returns 200 but
 * every following POST (`notifications/initialized`, `tools/list`,
 * `tools/call`) returns HTTP 500 with an empty body, so the HTTP transport
 * lists/calls zero tools (issue #47). Building a fresh Server +
 * StreamableHTTPServerTransport per request — and disposing both when the
 * response closes — is the SDK's stateless pattern and fixes this.
 */
async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // This handler is invoked fire-and-forget (`void handleMcpRequest(...)`), so
  // it must NEVER reject: qbo-mcp installs a global `unhandledRejection`
  // handler that calls process.exit(1) (see below), which means a single bad
  // /mcp request could otherwise crash the whole HTTP server. Everything —
  // including server/transport construction and the error response itself — is
  // wrapped so nothing escapes to that global handler.
  try {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      void transport.close().catch(() => {});
      void server.close().catch(() => {});
    });

    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error("Error handling MCP request:", err);
    try {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
      }
      if (!res.writableEnded) {
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal error" },
            id: null,
          })
        );
      }
    } catch {
      // Response already torn down — nothing more we can safely do.
    }
  }
}

/**
 * Start the server with HTTP Streamable transport.
 * In gateway mode, credentials are extracted from request headers on each request
 * and never fall back to QBO_* in the process environment.
 */
export async function startHttpTransport(): Promise<HttpServer> {
  const port = parseInt(process.env.MCP_HTTP_PORT || "8080", 10);
  const { secret: s2sSecret, insecureDev } = resolveHttpS2sSecret();
  const host = resolveBindHost(!insecureDev);
  const authMode = (process.env.AUTH_MODE as AuthMode) || "env";
  const isGatewayMode = authMode === "gateway";

  const httpServer = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(
        req.url || "/",
        `http://${req.headers.host || "localhost"}`
      );

      // Health endpoint — unauthenticated liveness. Must not read credentials.
      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            transport: "http",
            authMode: isGatewayMode ? "gateway" : "env",
            timestamp: new Date().toISOString(),
          })
        );
        return;
      }

      // MCP endpoint
      if (url.pathname === "/mcp") {
        // Empty s2sSecret is only reachable when MCP_ALLOW_INSECURE_DEV=1.
        // A configured secret is always enforced, before credential extraction.
        const s2sHeader = headerValue(req.headers[S2S_HEADER]);
        if (s2sSecret && !verifyS2sHeader(s2sHeader, s2sSecret)) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.",
            })
          );
          return;
        }

        // In gateway mode, extract credentials from headers. Blank or missing
        // headers are rejected here so the request cannot fall through to
        // QBO_ACCESS_TOKEN / QBO_REALM_ID in the process environment.
        if (isGatewayMode) {
          const { creds, error, status } = resolveGatewayCredentials(
            (name) => headerValue(req.headers[name])
          );
          if (error || !creds) {
            if (status === 400) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  error: "Invalid X-Qbo-Environment or X-Qbo-Realm-Id header",
                  message: error,
                })
              );
              return;
            }
            console.error(
              "Gateway mode: Missing X-Qbo-Access-Token or X-Qbo-Realm-Id header"
            );
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Missing credentials",
                message: error,
                required: ["X-Qbo-Access-Token", "X-Qbo-Realm-Id"],
                optional: ["X-Qbo-Environment (production|sandbox, default production)"],
              })
            );
            return;
          }

          // Run the per-request MCP handler within an AsyncLocalStorage context
          // so getClient() picks up these credentials without mutating
          // process.env. This prevents concurrent requests from overwriting
          // each other's creds.
          credentialStore.run(creds, () => void handleMcpRequest(req, res));
          return;
        }

        void handleMcpRequest(req, res);
        return;
      }

      // 404 for everything else
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Not found",
          endpoints: ["/mcp", "/health"],
        })
      );
    }
  );

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      console.error(
        `QBO MCP server listening on http://${host}:${port}/mcp`
      );
      console.error(
        `Health check available at http://${host}:${port}/health`
      );
      console.error(
        `Authentication mode: ${isGatewayMode ? "gateway (header-based)" : "env (environment variables)"}`
      );
      resolve();
    });
  });

  return httpServer;
}

/**
 * Main entry point - selects transport based on MCP_TRANSPORT env var
 */
async function main() {
  const transportType =
    (process.env.MCP_TRANSPORT as TransportType) || "stdio";

  if (transportType === "http") {
    const httpServer = await startHttpTransport();
    const shutdown = async () => {
      console.error("Shutting down QBO MCP server...");
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } else {
    await startStdioTransport();
  }
}

// Vitest imports this module to call startHttpTransport. Skip the CLI
// entrypoint there. `node dist/index.js` still starts stdio or HTTP.
if (process.env.VITEST !== "true") {
  process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
    process.exit(1);
  });

  process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception:", error);
    process.exit(1);
  });

  main().catch(console.error);
}
