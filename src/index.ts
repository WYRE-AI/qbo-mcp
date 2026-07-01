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
 *                 or pass X-Qbo-Access-Token and X-Qbo-Realm-Id headers (gateway mode)
 * Rate Limit: 500 requests/minute
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { credentialStore } from "./utils/client.js";
import {
  createMcpServer,
  resolveGatewayCredentials,
} from "./mcp-server.js";

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
 * Start the server with HTTP Streamable transport
 * In gateway mode, credentials are extracted from request headers on each request
 */
async function startHttpTransport(): Promise<void> {
  const port = parseInt(process.env.MCP_HTTP_PORT || "8080", 10);
  const host = process.env.MCP_HTTP_HOST || "0.0.0.0";
  const authMode = (process.env.AUTH_MODE as AuthMode) || "env";
  const isGatewayMode = authMode === "gateway";

  const httpServer = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(
        req.url || "/",
        `http://${req.headers.host || "localhost"}`
      );

      // Health endpoint - no auth required
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
        // In gateway mode, extract credentials from headers
        if (isGatewayMode) {
          const { creds, error, status } = resolveGatewayCredentials(
            (name) => req.headers[name] as string | undefined
          );
          if (error || !creds) {
            if (status === 400) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  error: "Invalid X-Qbo-Environment header",
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

  await new Promise<void>((resolve) => {
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

  // Graceful shutdown
  const shutdown = async () => {
    console.error("Shutting down QBO MCP server...");
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * Main entry point - selects transport based on MCP_TRANSPORT env var
 */
async function main() {
  const transportType =
    (process.env.MCP_TRANSPORT as TransportType) || "stdio";

  if (transportType === "http") {
    await startHttpTransport();
  } else {
    await startStdioTransport();
  }
}

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

main().catch(console.error);
