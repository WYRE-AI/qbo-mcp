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
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Domain imports
import { customerTools, handleCustomerTool } from "./domains/customers.js";
import { invoiceTools, handleInvoiceTool } from "./domains/invoices.js";
import { expenseTools, handleExpenseTool } from "./domains/expenses.js";
import { paymentTools, handlePaymentTool } from "./domains/payments.js";
import { reportTools, handleReportTool } from "./domains/reports.js";
import { credentialStore } from "./utils/client.js";
import { setServerRef } from "./utils/server-ref.js";

/**
 * Transport and auth configuration types
 */
type TransportType = "stdio" | "http";
type AuthMode = "env" | "gateway";

/**
 * Available domains for navigation
 */
type Domain =
  | "customers"
  | "invoices"
  | "expenses"
  | "payments"
  | "reports";

/**
 * Domain metadata for navigation
 */
const domainDescriptions: Record<Domain, string> = {
  customers:
    "Customer management - list, get, create, and search customers",
  invoices:
    "Invoice management - list, get, create invoices and send them by email",
  expenses:
    "Expense tracking - list and view purchases and bills",
  payments:
    "Payment management - list, get, and create payments linked to invoices",
  reports:
    "Financial reports - profit & loss, balance sheet, aged receivables/payables, customer sales",
};

/**
 * Map from domain name to its tool definitions (loaded lazily)
 */
const domainToolMap = new Map<Domain, Tool[]>();

/**
 * All domain tools, collected once at startup
 */
let allDomainTools: Tool[] | null = null;

/**
 * Get tools for a specific domain
 */
function getDomainTools(domain: Domain): Tool[] {
  switch (domain) {
    case "customers":
      return customerTools;
    case "invoices":
      return invoiceTools;
    case "expenses":
      return expenseTools;
    case "payments":
      return paymentTools;
    case "reports":
      return reportTools;
  }
}

/**
 * Load all domain tools (lazy-loaded on first access)
 */
async function getAllDomainTools(): Promise<Tool[]> {
  if (allDomainTools !== null) {
    return allDomainTools;
  }

  const domains: Domain[] = ["customers", "invoices", "expenses", "payments", "reports"];
  const tools: Tool[] = [];

  for (const domain of domains) {
    if (!domainToolMap.has(domain)) {
      const domainTools = getDomainTools(domain);
      domainToolMap.set(domain, domainTools);
    }
    tools.push(...domainToolMap.get(domain)!);
  }

  allDomainTools = tools;
  return tools;
}

/**
 * Navigation / discovery tool - helps the LLM find the right tools
 *
 * This is a stateless helper that describes available tools for a domain.
 * All domain tools are always listed in tools/list regardless of navigation
 * state, because many MCP clients (claude.ai connectors, mcp-remote) only
 * fetch the tool list once and do not support notifications/tools/list_changed.
 */
const navigateTool: Tool = {
  name: "qbo_navigate",
  description:
    "Discover available QuickBooks Online tools by domain. Returns tool names and descriptions for the selected domain. All tools are callable at any time — this is a help/discovery aid, not a prerequisite.",
  inputSchema: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        enum: [
          "customers",
          "invoices",
          "expenses",
          "payments",
          "reports",
        ],
        description: `The domain to explore:
- customers: ${domainDescriptions.customers}
- invoices: ${domainDescriptions.invoices}
- expenses: ${domainDescriptions.expenses}
- payments: ${domainDescriptions.payments}
- reports: ${domainDescriptions.reports}`,
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
  const domainTools = await getAllDomainTools();
  return { tools: [navigateTool, statusTool, ...domainTools] };
});

/**
 * Handle CallTool requests
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Handle navigation / discovery helper
    if (name === "qbo_navigate") {
      const { domain } = args as { domain: Domain };

      if (!["customers", "invoices", "expenses", "payments", "reports"].includes(domain)) {
        return {
          content: [
            {
              type: "text",
              text: `Invalid domain: ${domain}. Available domains: customers, invoices, expenses, payments, reports`,
            },
          ],
          isError: true,
        };
      }

      const domainTools = getDomainTools(domain);
      const toolSummary = domainTools
        .map((t) => `- ${t.name}: ${t.description}`)
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: `${domainDescriptions[domain]}\n\nAvailable tools:\n${toolSummary}\n\nYou can call any of these tools directly.`,
          },
        ],
      };
    }

    if (name === "qbo_status") {
      const accessToken = process.env.QBO_ACCESS_TOKEN;
      const realmId = process.env.QBO_REALM_ID;
      const credStatus = (accessToken && realmId)
        ? `Configured (realm: ${realmId})`
        : "NOT CONFIGURED - Please set environment variables";

      return {
        content: [
          {
            type: "text",
            text: `QuickBooks Online MCP Server Status\n\nCredentials: ${credStatus}\nAvailable domains: customers, invoices, expenses, payments, reports\n\nAll tools are available at all times. Use qbo_navigate to discover tools by domain.`,
          },
        ],
      };
    }

    // Route to appropriate domain handler
    const toolArgs = (args ?? {}) as Record<string, unknown>;

    if (name.startsWith("qbo_customers_")) {
      return await handleCustomerTool(name, toolArgs);
    }
    if (name.startsWith("qbo_invoices_")) {
      return await handleInvoiceTool(name, toolArgs);
    }
    if (name.startsWith("qbo_expenses_")) {
      return await handleExpenseTool(name, toolArgs);
    }
    if (name.startsWith("qbo_payments_")) {
      return await handlePaymentTool(name, toolArgs);
    }
    if (name.startsWith("qbo_reports_")) {
      return await handleReportTool(name, toolArgs);
    }

    // Unknown tool
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

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
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
              })
            );
            return;
          }

          // Run the MCP handler within an AsyncLocalStorage context so that
          // getClient() picks up these credentials without mutating process.env.
          // This prevents concurrent requests from overwriting each other's creds.
          credentialStore.run({ accessToken, realmId }, () => {
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
