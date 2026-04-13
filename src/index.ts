#!/usr/bin/env node
/**
 * QuickBooks Online MCP Server
 *
 * This MCP server provides tools for interacting with the QuickBooks Online API.
 * It implements a decision tree architecture where tools are dynamically
 * loaded based on the selected domain.
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
 * Server state management
 */
interface ServerState {
  currentDomain: Domain | null;
}

const state: ServerState = {
  currentDomain: null,
};

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
 * Navigation tool - entry point for decision tree
 */
const navigateTool: Tool = {
  name: "qbo_navigate",
  description:
    "Navigate to a specific domain in QuickBooks Online. Call this first to select which area you want to work with. After navigation, domain-specific tools will be available.",
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
        description: `The domain to navigate to:
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
 * Back navigation tool - return to domain selection
 */
const backTool: Tool = {
  name: "qbo_back",
  description:
    "Return to domain selection. Use this to switch to a different area of QuickBooks Online.",
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
 * Handle ListTools requests - returns tools based on current state
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools: Tool[] = [];

  if (state.currentDomain === null) {
    // At root - show navigation tool only
    tools.push(navigateTool);
  } else {
    // In a domain - show domain tools plus back navigation
    tools.push(backTool);
    tools.push(...getDomainTools(state.currentDomain));
  }

  return { tools };
});

/**
 * Handle CallTool requests
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Handle navigation
    if (name === "qbo_navigate") {
      const { domain } = args as { domain: Domain };
      state.currentDomain = domain;

      const domainTools = getDomainTools(domain);
      const toolNames = domainTools.map((t) => t.name).join(", ");

      return {
        content: [
          {
            type: "text",
            text: `Navigated to ${domain} domain. Available tools: ${toolNames}`,
          },
        ],
      };
    }

    // Handle back navigation
    if (name === "qbo_back") {
      state.currentDomain = null;
      return {
        content: [
          {
            type: "text",
            text: "Returned to domain selection. Use qbo_navigate to select a domain: customers, invoices, expenses, payments, reports",
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
          text: `Unknown tool: ${name}. Use qbo_navigate to select a domain first.`,
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
