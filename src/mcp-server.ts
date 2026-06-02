/**
 * Shared MCP server factory for QuickBooks Online.
 *
 * This module is **side-effect free** (importing it never starts a transport),
 * so it can be reused by every entrypoint:
 * - `index.ts`  — stdio + Node HTTP transport
 * - `worker.ts` — Cloudflare Workers (Web Standard) transport
 *
 * All QBO tools are exposed upfront (flat architecture) for universal MCP
 * client compatibility. Credentials are NOT baked into the server: every
 * request resolves them through the `credentialStore` AsyncLocalStorage
 * (gateway headers) or `process.env` (env mode), so a single server instance
 * can safely serve concurrent requests with different credentials.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
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
import {
  credentialStore,
  parseEnvironment,
  QboApiError,
  type QboCredentials,
} from "./utils/client.js";
import { setServerRef } from "./utils/server-ref.js";

export type { QboCredentials };
export { credentialStore, parseEnvironment };

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
 * Resolve per-request gateway credentials from a header accessor.
 *
 * Works with any transport: pass a getter that returns a (lowercased) header
 * value. Returns `{ creds }` on success, `{ error }` when required headers are
 * missing, or `{ error, status: 400 }` when the environment header is invalid.
 */
export function resolveGatewayCredentials(
  getHeader: (lowerName: string) => string | undefined,
): { creds?: QboCredentials; error?: string; status?: number } {
  const accessToken = getHeader("x-qbo-access-token");
  const realmId = getHeader("x-qbo-realm-id");

  let environment: QboCredentials["environment"];
  try {
    environment = parseEnvironment(getHeader("x-qbo-environment"));
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      status: 400,
    };
  }

  if (!accessToken || !realmId) {
    return {
      error:
        "Gateway mode requires X-Qbo-Access-Token and X-Qbo-Realm-Id headers",
      status: 401,
    };
  }

  return { creds: { accessToken, realmId, environment } };
}

/**
 * Create a fresh MCP server instance with all handlers registered.
 *
 * The returned server is credential-agnostic — handlers read credentials at
 * call time from `credentialStore` (gateway) or `process.env` (env), so the
 * same instance can be reused across requests, or recreated per request.
 */
export function createMcpServer(): Server {
  const server = new Server(
    {
      name: "qbo-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  setServerRef(server);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: [navigateTool, statusTool, ...allTools] };
  });

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

  return server;
}
