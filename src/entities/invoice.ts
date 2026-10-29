/**
 * Invoice entity config. Generator handles get, create, update, and void.
 * Void is `POST /invoice?operation=void` (not the Payment `include=void` form).
 * List is overridden for the Paid/Unpaid/Overdue status filter + date-range
 * elicitation; the get handler is overridden to attach the MCP Apps `_card`
 * payload. Send is a non-CRUD action (POST /invoice/:id/send).
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { attachInvoiceCard } from "../card.builder.js";
import { getClient } from "../utils/client.js";
import { elicitText } from "../utils/elicitation.js";
import {
  buildDatedListSql,
  type DatedListArgs,
} from "../utils/qbo-sql.js";
import { jsonText } from "./generator.js";
import type {
  EntityConfig,
  EntityExtras,
  EntityField,
  ToolResult,
} from "./types.js";

const invoiceFields: EntityField[] = [
  {
    name: "CustomerRef",
    type: "object",
    required: true,
    description:
      'Customer reference object, e.g. {"value": "123"} where value is the customer ID',
  },
  {
    name: "Line",
    type: "array",
    required: true,
    description:
      'Array of line items. Each line should have Amount, DetailType ("SalesItemLineDetail"), and SalesItemLineDetail with ItemRef. On update, providing Line replaces the invoice line items.',
    items: { type: "object" },
  },
  { name: "DueDate", type: "string", description: "Due date (YYYY-MM-DD)" },
  { name: "TxnDate", type: "string", description: "Transaction date (YYYY-MM-DD)" },
  {
    name: "BillEmail",
    type: "object",
    description:
      'Email address to send the invoice to, e.g. {"Address": "customer@example.com"}',
  },
  {
    name: "PrivateNote",
    type: "string",
    description: "Private note (not visible to customer)",
  },
  {
    name: "CustomerMemo",
    type: "object",
    description:
      'Memo visible to customer, e.g. {"value": "Thank you for your business"}',
  },
];

const invoiceUpdateFields: EntityField[] = invoiceFields.map((field) =>
  // CustomerRef and Line are required to create an invoice. A sparse update
  // may change other fields without resending them.
  field.name === "CustomerRef" || field.name === "Line"
    ? { ...field, required: false }
    : field
);

/**
 * QBO voids an invoice even when a payment is applied: the payment is left as
 * an unapplied credit. Refuse unless the caller explicitly confirms.
 */
async function guardPaidInvoiceVoid(
  args: Record<string, unknown>
): Promise<ToolResult | null> {
  if (args.confirmPaidInvoiceVoid === true) return null;
  const invoiceId = args.invoiceId as string;
  const response = (await getClient().get(`invoice/${invoiceId}`)) as {
    Invoice?: {
      Id?: string;
      TotalAmt?: number;
      Balance?: number;
      LinkedTxn?: { TxnId?: string; TxnType?: string }[];
    };
  };
  const invoice = response?.Invoice;
  const payments = (invoice?.LinkedTxn ?? []).filter((t) => t.TxnType === "Payment");
  const partlyPaid =
    typeof invoice?.Balance === "number" &&
    typeof invoice?.TotalAmt === "number" &&
    invoice.Balance < invoice.TotalAmt;
  if (payments.length === 0 && !partlyPaid) return null;
  const ids = payments.map((p) => p.TxnId).join(", ") || "none listed";
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `Refusing to void invoice ${invoice?.Id ?? invoiceId}: it has a payment applied (TotalAmt ${invoice?.TotalAmt}, Balance ${invoice?.Balance}, linked payment Ids: ${ids}). Voiding would leave the payment as an unapplied credit. Pass confirmPaidInvoiceVoid: true only if the user explicitly asked to void a paid invoice.`,
      },
    ],
  };
}

export const invoiceConfig: EntityConfig = {
  name: "Invoice",
  toolPrefix: "qbo_invoices",
  description:
    "Invoice management - list, get, create, update, and void invoices, and send them by email",
  // list is overridden in extras to add the status filter + elicitation.
  get: { idParam: "invoiceId" },
  create: { fields: invoiceFields },
  update: { idParam: "invoiceId", fields: invoiceUpdateFields },
  void: {
    idParam: "invoiceId",
    style: "operation",
    description:
      "Voids the invoice in QuickBooks. This works even if a payment has already been applied, and the payment then stays as an unapplied credit. Check the invoice's balance and payments first, and only void a paid invoice if the user explicitly asks for it.",
    note: "Id and SyncToken are required; confirmPaidInvoiceVoid: true is needed when a payment is applied.",
    extraProperties: {
      confirmPaidInvoiceVoid: {
        type: "boolean",
        description:
          "Set to true only when the user explicitly asked to void an invoice that has a payment applied. Without it, the tool refuses to void a paid or partly paid invoice.",
      },
    },
    guard: guardPaidInvoiceVoid,
  },
};

const invoicesListTool: Tool = {
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
        description: "Maximum number of results to return (default: 100, max: 1000)",
      },
      status: {
        type: "string",
        enum: ["Paid", "Unpaid", "Overdue"],
        description: "Filter invoices by balance status",
      },
      startDate: {
        type: "string",
        description: "Filter invoices on or after this date (YYYY-MM-DD format)",
      },
      endDate: {
        type: "string",
        description: "Filter invoices on or before this date (YYYY-MM-DD format)",
      },
    },
  },
};

const invoicesSendTool: Tool = {
  name: "qbo_invoices_send",
  description:
    "Send an invoice by email. The invoice must already exist in QuickBooks Online.",
  inputSchema: {
    type: "object",
    properties: {
      invoiceId: { type: "string", description: "The unique invoice ID to send" },
      email: {
        type: "string",
        description:
          "Override email address to send to (optional, uses invoice BillEmail if not specified)",
      },
    },
    required: ["invoiceId"],
  },
};

export const invoiceExtras: EntityExtras = {
  tools: [invoicesListTool, invoicesSendTool],
  handlers: {
    qbo_invoices_get: async (args) => {
      const { invoiceId } = args as { invoiceId: string };
      const result = await getClient().get(`invoice/${invoiceId}`);
      // MCP Apps: attach the normalized card payload the ui:// invoice card
      // renders from. Best-effort — no card just means no UI surface, and
      // the full JSON payload is otherwise unchanged.
      const merged = attachInvoiceCard(result) as Record<string, unknown>;
      // SEP-1865: content/structuredContent separation — a short text
      // summary goes in `content`, the full payload (including _card)
      // moves to `structuredContent`. No fields are dropped, only relocated.
      const invoice = merged.Invoice as
        | { DocNumber?: unknown; TotalAmt?: unknown; Balance?: unknown }
        | undefined;
      const docNumber =
        typeof invoice?.DocNumber === "string" ? invoice.DocNumber : invoiceId;
      const balance = typeof invoice?.Balance === "number" ? invoice.Balance : undefined;
      const summary =
        balance !== undefined
          ? `Retrieved invoice #${docNumber} (balance: ${balance}).`
          : `Retrieved invoice #${docNumber}.`;
      return {
        content: [{ type: "text", text: summary }],
        structuredContent: merged,
      };
    },

    qbo_invoices_list: async (args) => {
      const rawArgs = args as DatedListArgs & { status?: string };
      const { status } = rawArgs;
      let { startDate, endDate } = rawArgs;

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
      if (status === "Paid") statusConditions.push("Balance = '0'");
      else if (status === "Unpaid") statusConditions.push("Balance > '0'");
      else if (status === "Overdue") {
        const today = new Date().toISOString().slice(0, 10);
        statusConditions.push(`Balance > '0' AND DueDate < '${today}'`);
      }

      const sql = buildDatedListSql(
        "Invoice",
        { ...rawArgs, startDate, endDate },
        statusConditions
      );
      return jsonText(await getClient().query(sql));
    },

    qbo_invoices_send: async (args) => {
      const { invoiceId, email } = args as { invoiceId: string; email?: string };
      const params: Record<string, string> = {};
      if (email) params.sendTo = email;
      return jsonText(
        await getClient().post(`invoice/${invoiceId}/send`, undefined, params)
      );
    },
  },
};
