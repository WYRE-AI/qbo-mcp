/**
 * Payments domain tools for QBO MCP Server
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../utils/client.js";
import { buildDatedListSql, type DatedListArgs } from "../utils/qbo-sql.js";

/**
 * Payment domain tool definitions
 */
export const paymentTools: Tool[] = [
  {
    name: "qbo_payments_list",
    description:
      "List payments in QuickBooks Online with pagination. Returns payment details including customer, amount, and linked transactions.",
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
            "Filter payments on or after this date (YYYY-MM-DD format)",
        },
        endDate: {
          type: "string",
          description:
            "Filter payments on or before this date (YYYY-MM-DD format)",
        },
      },
    },
  },
  {
    name: "qbo_payments_get",
    description:
      "Get detailed information about a specific payment by its ID. Returns full payment details including linked invoices.",
    inputSchema: {
      type: "object",
      properties: {
        paymentId: {
          type: "string",
          description: "The unique payment ID",
        },
      },
      required: ["paymentId"],
    },
  },
  {
    name: "qbo_payments_create",
    description:
      "Create a new payment in QuickBooks Online. Requires a customer reference and total amount. Optionally link to invoices.",
    inputSchema: {
      type: "object",
      properties: {
        CustomerRef: {
          type: "object",
          description:
            'Customer reference object, e.g. {"value": "123"} where value is the customer ID',
        },
        TotalAmt: {
          type: "number",
          description: "Total payment amount",
        },
        Line: {
          type: "array",
          description:
            'Array of line items linking payment to invoices. Each line should have Amount and LinkedTxn array with TxnId and TxnType ("Invoice").',
          items: {
            type: "object",
          },
        },
        TxnDate: {
          type: "string",
          description: "Payment date (YYYY-MM-DD format)",
        },
        PaymentMethodRef: {
          type: "object",
          description:
            'Payment method reference, e.g. {"value": "1"} for check, {"value": "2"} for cash',
        },
        DepositToAccountRef: {
          type: "object",
          description:
            'Account to deposit payment to, e.g. {"value": "35"} for Undeposited Funds',
        },
        PrivateNote: {
          type: "string",
          description: "Private memo for the payment",
        },
      },
      required: ["CustomerRef", "TotalAmt"],
    },
  },
];

/**
 * Handle payment domain tool calls
 */
export async function handlePaymentTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const client = getClient();

  switch (name) {
    case "qbo_payments_list": {
      const response = await client.query(
        buildDatedListSql("Payment", args as DatedListArgs)
      );
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    case "qbo_payments_get": {
      const { paymentId } = args as { paymentId: string };
      const payment = await client.get(`payment/${paymentId}`);
      return {
        content: [{ type: "text", text: JSON.stringify(payment, null, 2) }],
      };
    }

    case "qbo_payments_create": {
      const {
        CustomerRef,
        TotalAmt,
        Line,
        TxnDate,
        PaymentMethodRef,
        DepositToAccountRef,
        PrivateNote,
      } = args as {
        CustomerRef: { value: string };
        TotalAmt: number;
        Line?: unknown[];
        TxnDate?: string;
        PaymentMethodRef?: { value: string };
        DepositToAccountRef?: { value: string };
        PrivateNote?: string;
      };

      const body: Record<string, unknown> = { CustomerRef, TotalAmt };
      if (Line) body.Line = Line;
      if (TxnDate) body.TxnDate = TxnDate;
      if (PaymentMethodRef) body.PaymentMethodRef = PaymentMethodRef;
      if (DepositToAccountRef)
        body.DepositToAccountRef = DepositToAccountRef;
      if (PrivateNote) body.PrivateNote = PrivateNote;

      const payment = await client.post("payment", body);
      return {
        content: [{ type: "text", text: JSON.stringify(payment, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown payment tool: ${name}` }],
        isError: true,
      };
  }
}
