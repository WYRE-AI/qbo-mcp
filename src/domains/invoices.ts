/**
 * Invoices domain tools for QBO MCP Server
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../utils/client.js";
import { elicitText } from "../utils/elicitation.js";
import { buildDatedListSql, type DatedListArgs } from "../utils/qbo-sql.js";

/**
 * Invoice domain tool definitions
 */
export const invoiceTools: Tool[] = [
  {
    name: "qbo_invoices_list",
    description:
      "List invoices in QuickBooks Online with pagination and optional filters for status and date range.",
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
        status: {
          type: "string",
          enum: ["Paid", "Unpaid", "Overdue"],
          description: "Filter invoices by balance status",
        },
        startDate: {
          type: "string",
          description:
            "Filter invoices on or after this date (YYYY-MM-DD format)",
        },
        endDate: {
          type: "string",
          description:
            "Filter invoices on or before this date (YYYY-MM-DD format)",
        },
      },
    },
  },
  {
    name: "qbo_invoices_get",
    description:
      "Get detailed information about a specific invoice by its ID. Returns full invoice including line items, customer ref, and balance.",
    inputSchema: {
      type: "object",
      properties: {
        invoiceId: {
          type: "string",
          description: "The unique invoice ID",
        },
      },
      required: ["invoiceId"],
    },
  },
  {
    name: "qbo_invoices_create",
    description:
      "Create a new invoice in QuickBooks Online. Requires a customer reference and at least one line item.",
    inputSchema: {
      type: "object",
      properties: {
        CustomerRef: {
          type: "object",
          description:
            'Customer reference object, e.g. {"value": "123"} where value is the customer ID',
        },
        Line: {
          type: "array",
          description:
            'Array of line items. Each line should have Amount, DetailType ("SalesItemLineDetail"), and SalesItemLineDetail with ItemRef.',
          items: {
            type: "object",
          },
        },
        DueDate: {
          type: "string",
          description: "Due date for the invoice (YYYY-MM-DD format)",
        },
        TxnDate: {
          type: "string",
          description: "Transaction date (YYYY-MM-DD format)",
        },
        BillEmail: {
          type: "object",
          description:
            'Email address to send the invoice to, e.g. {"Address": "customer@example.com"}',
        },
        PrivateNote: {
          type: "string",
          description: "Private note (not visible to customer)",
        },
        CustomerMemo: {
          type: "object",
          description:
            'Memo visible to customer, e.g. {"value": "Thank you for your business"}',
        },
      },
      required: ["CustomerRef", "Line"],
    },
  },
  {
    name: "qbo_invoices_send",
    description:
      "Send an invoice by email. The invoice must already exist in QuickBooks Online.",
    inputSchema: {
      type: "object",
      properties: {
        invoiceId: {
          type: "string",
          description: "The unique invoice ID to send",
        },
        email: {
          type: "string",
          description:
            "Override email address to send to (optional, uses invoice BillEmail if not specified)",
        },
      },
      required: ["invoiceId"],
    },
  },
];

/**
 * Handle invoice domain tool calls
 */
export async function handleInvoiceTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const client = getClient();

  switch (name) {
    case "qbo_invoices_list": {
      const rawArgs = args as DatedListArgs & { status?: string };
      let { status, startDate, endDate } = rawArgs;

      if (!status && !startDate && !endDate && Object.keys(args).length === 0) {
        const from = await elicitText(
          "Would you like to filter invoices by date range? Enter a start date, or leave blank to list all.",
          "startDate",
          "Start date (YYYY-MM-DD)"
        );
        if (from) {
          startDate = from;
          const to = await elicitText(
            "Enter an end date for the invoice filter.",
            "endDate",
            "End date (YYYY-MM-DD)"
          );
          if (to) endDate = to;
        }
      }

      const statusConditions: string[] = [];
      if (status === "Paid") {
        statusConditions.push("Balance = '0'");
      } else if (status === "Unpaid") {
        statusConditions.push("Balance > '0'");
      } else if (status === "Overdue") {
        const today = new Date().toISOString().slice(0, 10);
        statusConditions.push(`Balance > '0' AND DueDate < '${today}'`);
      }

      const sql = buildDatedListSql(
        "Invoice",
        { ...rawArgs, startDate, endDate },
        statusConditions
      );
      const response = await client.query(sql);
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    case "qbo_invoices_get": {
      const { invoiceId } = args as { invoiceId: string };
      const invoice = await client.get(`invoice/${invoiceId}`);
      return {
        content: [{ type: "text", text: JSON.stringify(invoice, null, 2) }],
      };
    }

    case "qbo_invoices_create": {
      const {
        CustomerRef,
        Line,
        DueDate,
        TxnDate,
        BillEmail,
        PrivateNote,
        CustomerMemo,
      } = args as {
        CustomerRef: { value: string };
        Line: unknown[];
        DueDate?: string;
        TxnDate?: string;
        BillEmail?: { Address: string };
        PrivateNote?: string;
        CustomerMemo?: { value: string };
      };

      const body: Record<string, unknown> = { CustomerRef, Line };
      if (DueDate) body.DueDate = DueDate;
      if (TxnDate) body.TxnDate = TxnDate;
      if (BillEmail) body.BillEmail = BillEmail;
      if (PrivateNote) body.PrivateNote = PrivateNote;
      if (CustomerMemo) body.CustomerMemo = CustomerMemo;

      const invoice = await client.post("invoice", body);
      return {
        content: [{ type: "text", text: JSON.stringify(invoice, null, 2) }],
      };
    }

    case "qbo_invoices_send": {
      const { invoiceId, email } = args as {
        invoiceId: string;
        email?: string;
      };

      const params: Record<string, string> = {};
      if (email) {
        params.sendTo = email;
      }

      const response = await client.post(
        `invoice/${invoiceId}/send`,
        undefined,
        params
      );
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown invoice tool: ${name}` }],
        isError: true,
      };
  }
}
