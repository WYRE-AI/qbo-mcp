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

// Single shared server instance. It is credential-agnostic — every request
// resolves its own credentials via credentialStore (gateway) or process.env
// (env), so one instance can serve all transports/requests.
const server = createMcpServer();

/**
 * Start the server with stdio transport (default)
 */
async function startStdioTransport(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("QBO MCP server running on stdio");
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

  // Stateless transport: sessionIdGenerator is undefined on purpose. qbo-mcp
  // holds no per-session state — every request carries its own credentials
  // (X-Qbo-* headers in gateway mode, env vars otherwise) and is handled
  // independently. A stateful transport (sessionIdGenerator set) would issue
  // an Mcp-Session-Id on `initialize` and require it on every later call;
  // since this server reuses ONE shared transport rather than one per
  // session, that mode breaks re-initialization — the gateway's handshake
  // got "Bad Request: Mcp-Session-Id header is required" / 400 on every
  // tool call. Stateless is both correct here and what a single shared
  // transport supports.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

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

          // Run the MCP handler within an AsyncLocalStorage context so that
          // getClient() picks up these credentials without mutating process.env.
          // This prevents concurrent requests from overwriting each other's creds.
          credentialStore.run(creds, () => {
            transport.handleRequest(req, res);
          });
          return;
        }

        transport.handleRequest(req, res);
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

  await server.connect(transport);

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
    await server.close();
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
