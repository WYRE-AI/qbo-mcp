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
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Hand-written domains for tools that don't fit the entity-config pattern
import { expenseTools, handleExpenseTool } from "./domains/expenses.js";
import { reportTools, handleReportTool } from "./domains/reports.js";
// Generated entities (Customer, Invoice, Payment) flow through this registry
import {
  allEntityTools,
  dispatchTool,
  entityDomains,
} from "./entities/index.js";
import { credentialStore, parseEnvironment, QboApiError } from "./utils/client.js";
import { setServerRef } from "./utils/server-ref.js";

/**
 * Transport and auth configuration types
 */
type TransportType = "stdio" | "http";
type AuthMode = "env" | "gateway";

/**
 * Domain catalog combining generator-driven entities (Customer, Invoice,
 * Payment, ...) with hand-written domains (Expenses legacy naming, Reports).
 * Used for qbo_navigate listings and to assemble the tools array.
 */
interface DomainInfo {
  prefix: string;
  description: string;
  tools: Tool[];
}

const handWrittenDomains: DomainInfo[] = [
  {
    prefix: "qbo_expenses",
    description: "Expense tracking - list and view purchases and bills",
    tools: expenseTools,
  },
  {
    prefix: "qbo_reports",
    description:
      "Financial reports - profit & loss, balance sheet, aged receivables/payables, customer sales",
    tools: reportTools,
  },
];

const allDomains: DomainInfo[] = [...entityDomains, ...handWrittenDomains];
const allTools: Tool[] = [...allEntityTools, ...expenseTools, ...reportTools];

/** Short domain name (e.g. "customers") derived from a tool prefix. */
function shortName(prefix: string): string {
  return prefix.replace(/^qbo_/, "");
}

const domainShortNames: string[] = allDomains.map((d) => shortName(d.prefix));

const navigateTool: Tool = {
  name: "qbo_navigate",
  description:
    "Discover available QuickBooks Online tools by domain. Returns tool names and descriptions for the selected domain. All tools are callable at any time — this is a help/discovery aid, not a prerequisite.",
  inputSchema: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        enum: domainShortNames,
        description: `The domain to explore:\n${allDomains
          .map((d) => `- ${shortName(d.prefix)}: ${d.description}`)
          .join("\n")}`,
      },
    },
    required: ["domain"],
  },
};

/**
 * Status tool - shows credentials status and available domains
 */
const statusTool: Tool = {
  name: "qbo_status",
  description: "Show credentials status and available domains",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

/**
 * Create the MCP server
 */
const server = new Server(
  {
    name: "qbo-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

setServerRef(server);

/**
 * Handle ListTools requests - always returns ALL tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: [navigateTool, statusTool, ...allTools] };
});

/**
 * Handle CallTool requests
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "qbo_navigate") {
      const { domain } = args as { domain: string };
      const match = allDomains.find((d) => shortName(d.prefix) === domain);
      if (!match) {
        return {
          content: [
            {
              type: "text",
              text: `Invalid domain: ${domain}. Available domains: ${domainShortNames.join(", ")}`,
            },
          ],
          isError: true,
        };
      }
      const toolSummary = match.tools
        .map((t) => `- ${t.name}: ${t.description}`)
        .join("\n");
      return {
        content: [
          {
            type: "text",
            text: `${match.description}\n\nAvailable tools:\n${toolSummary}\n\nYou can call any of these tools directly.`,
          },
        ],
      };
    }

    if (name === "qbo_status") {
      const override = credentialStore.getStore();
      const accessToken = override?.accessToken ?? process.env.QBO_ACCESS_TOKEN;
      const realmId = override?.realmId ?? process.env.QBO_REALM_ID;
      const environment =
        override?.environment ?? parseEnvironment(process.env.QBO_ENV);
      const credStatus =
        accessToken && realmId
          ? `Configured (realm: ${realmId}, environment: ${environment})`
          : "NOT CONFIGURED - Please set credentials (env vars or gateway headers)";
      return {
        content: [
          {
            type: "text",
            text: `QuickBooks Online MCP Server Status\n\nCredentials: ${credStatus}\nAvailable domains: ${domainShortNames.join(", ")}\n\nAll tools are available at all times. Use qbo_navigate to discover tools by domain.`,
          },
        ],
      };
    }

    const toolArgs = (args ?? {}) as Record<string, unknown>;

    // Generator-driven entities (Customer, Invoice, Payment, ...)
    const entityResult = await dispatchTool(name, toolArgs);
    if (entityResult) return entityResult;

    // Hand-written domains
    if (name.startsWith("qbo_expenses_")) {
      return await handleExpenseTool(name, toolArgs);
    }
    if (name.startsWith("qbo_reports_")) {
      return await handleReportTool(name, toolArgs);
    }

    return {
      content: [
        {
          type: "text",
          text: `Unknown tool: ${name}. Use qbo_navigate to discover available tools by domain.`,
        },
      ],
      isError: true,
    };
  } catch (error) {
    // Tag 401s structurally so a gateway can detect "refresh and retry". The
    // message starts with a stable prefix and the body is preserved verbatim.
    if (error instanceof QboApiError && error.isUnauthorized) {
      return {
        content: [
          {
            type: "text",
            text: `QBO_UNAUTHORIZED: access token rejected by QuickBooks Online (realm may also be wrong). Gateway should refresh the OAuth token and retry. Upstream body: ${error.body}`,
          },
        ],
        isError: true,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

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
          const accessToken = req.headers["x-qbo-access-token"] as
            | string
            | undefined;
          const realmId = req.headers["x-qbo-realm-id"] as
            | string
            | undefined;
          let environment: ReturnType<typeof parseEnvironment>;
          try {
            environment = parseEnvironment(
              req.headers["x-qbo-environment"] as string | undefined
            );
          } catch (err) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Invalid X-Qbo-Environment header",
                message: err instanceof Error ? err.message : String(err),
              })
            );
            return;
          }

          if (!accessToken || !realmId) {
            console.error(
              "Gateway mode: Missing X-Qbo-Access-Token or X-Qbo-Realm-Id header"
            );
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Missing credentials",
                message:
                  "Gateway mode requires X-Qbo-Access-Token and X-Qbo-Realm-Id headers",
                required: ["X-Qbo-Access-Token", "X-Qbo-Realm-Id"],
                optional: ["X-Qbo-Environment (production|sandbox, default production)"],
              })
            );
            return;
          }

          // Run the MCP handler within an AsyncLocalStorage context so that
          // getClient() picks up these credentials without mutating process.env.
          // This prevents concurrent requests from overwriting each other's creds.
          credentialStore.run({ accessToken, realmId, environment }, () => {
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
