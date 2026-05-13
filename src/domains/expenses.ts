/**
 * Expenses domain tools for QBO MCP Server
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../utils/client.js";
import { buildDatedListSql, type DatedListArgs } from "../utils/qbo-sql.js";

/**
 * Expense domain tool definitions
 */
export const expenseTools: Tool[] = [
  {
    name: "qbo_expenses_list_purchases",
    description:
      "List purchases (expenses/checks/credit card charges) in QuickBooks Online with pagination.",
    inputSchema: {
      type: "object",
      properties: {
        startPosition: {
          type: "number",
          description: "Starting position for pagination (1-based, default: 1)",
        },
        maxResults: {
          type: "number",
          description:
            "Maximum number of results to return (default: 100, max: 1000)",
        },
        startDate: {
          type: "string",
          description:
            "Filter purchases on or after this date (YYYY-MM-DD format)",
        },
        endDate: {
          type: "string",
          description:
            "Filter purchases on or before this date (YYYY-MM-DD format)",
        },
      },
    },
  },
  {
    name: "qbo_expenses_list_bills",
    description:
      "List bills (accounts payable) in QuickBooks Online with pagination.",
    inputSchema: {
      type: "object",
      properties: {
        startPosition: {
          type: "number",
          description: "Starting position for pagination (1-based, default: 1)",
        },
        maxResults: {
          type: "number",
          description:
            "Maximum number of results to return (default: 100, max: 1000)",
        },
        startDate: {
          type: "string",
          description:
            "Filter bills on or after this date (YYYY-MM-DD format)",
        },
        endDate: {
          type: "string",
          description:
            "Filter bills on or before this date (YYYY-MM-DD format)",
        },
      },
    },
  },
  {
    name: "qbo_expenses_get_purchase",
    description:
      "Get detailed information about a specific purchase by its ID. Returns full purchase details including line items and vendor info.",
    inputSchema: {
      type: "object",
      properties: {
        purchaseId: {
          type: "string",
          description: "The unique purchase ID",
        },
      },
      required: ["purchaseId"],
    },
  },
  {
    name: "qbo_expenses_get_bill",
    description:
      "Get detailed information about a specific bill by its ID. Returns full bill details including line items and vendor info.",
    inputSchema: {
      type: "object",
      properties: {
        billId: {
          type: "string",
          description: "The unique bill ID",
        },
      },
      required: ["billId"],
    },
  },
];

/**
 * Handle expense domain tool calls
 */
export async function handleExpenseTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const client = getClient();

  switch (name) {
    case "qbo_expenses_list_purchases": {
      const response = await client.query(
        buildDatedListSql("Purchase", args as DatedListArgs)
      );
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    case "qbo_expenses_list_bills": {
      const response = await client.query(
        buildDatedListSql("Bill", args as DatedListArgs)
      );
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    case "qbo_expenses_get_purchase": {
      const { purchaseId } = args as { purchaseId: string };
      const purchase = await client.get(`purchase/${purchaseId}`);
      return {
        content: [{ type: "text", text: JSON.stringify(purchase, null, 2) }],
      };
    }

    case "qbo_expenses_get_bill": {
      const { billId } = args as { billId: string };
      const bill = await client.get(`bill/${billId}`);
      return {
        content: [{ type: "text", text: JSON.stringify(bill, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown expense tool: ${name}` }],
        isError: true,
      };
  }
}
