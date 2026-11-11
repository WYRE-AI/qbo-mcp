/**
 * Payment entity config.
 *
 * Void uses `operation=update&include=void`. That is the Payment (and
 * SalesReceipt) form documented by Intuit and special-cased in the official
 * PHP SDK; `?operation=void` does not void a Payment.
 */

import { getClient } from "../utils/client.js";
import { assertQboId } from "../utils/qbo-ids.js";
import type { EntityConfig, EntityField } from "./types.js";

const paymentFields: EntityField[] = [
  {
    name: "CustomerRef",
    type: "object",
    required: true,
    description:
      'Customer reference object, e.g. {"value": "123"} where value is the customer ID',
  },
  {
    name: "TotalAmt",
    type: "number",
    required: true,
    description: "Total payment amount",
  },
  {
    name: "TxnDate",
    type: "string",
    description: "Transaction date (YYYY-MM-DD format)",
  },
  {
    name: "PaymentMethodRef",
    type: "object",
    description: 'Payment method reference object, e.g. {"value": "1"}',
  },
  {
    name: "DepositToAccountRef",
    type: "object",
    description:
      'Bank or asset account to deposit this payment into, e.g. {"value": "35"}. Omit on create to use Undeposited Funds. Omit on update to leave the existing deposit account unchanged.',
  },
  {
    name: "Line",
    type: "array",
    description:
      "Linked transactions applying this payment, e.g. [{Amount: 100, LinkedTxn: [{TxnId: '5', TxnType: 'Invoice'}]}]. On update, Line replaces existing applications. QuickBooks keeps one line per invoice: a second line for an invoice that is already linked replaces that amount instead of adding to it. To increase an application, send one line with the combined amount.",
    items: { type: "object" },
  },
];

const paymentUpdateFields: EntityField[] = paymentFields.map((field) =>
  // CustomerRef and TotalAmt are required to create a payment. A sparse
  // update may change Line or the deposit account without resending them.
  field.name === "CustomerRef"
    ? {
        ...field,
        required: false,
        description: "Required when you change Line. Otherwise optional.",
      }
    : field.name === "TotalAmt"
      ? { ...field, required: false }
      : field
);

export const paymentConfig: EntityConfig = {
  name: "Payment",
  toolPrefix: "qbo_payments",
  description:
    "Payment management - list, get, create, update, and void payments linked to invoices",
  list: { dateRange: true },
  get: { idParam: "paymentId" },
  create: { fields: paymentFields },
  update: {
    idParam: "paymentId",
    fields: paymentUpdateFields,
    note: "When Line is sent without CustomerRef, the tool reads the payment and resends its existing CustomerRef, because QuickBooks rejects a Line change without it. Sending Line replaces all existing lines on the payment, so include every line you want to keep.",
    // QBO returns 400 code 2020 for a Line change without CustomerRef.
    prepare: async (args) => {
      if (args.Line === undefined || args.CustomerRef !== undefined) return null;
      const paymentId = assertQboId(args.paymentId, "paymentId");
      assertQboId(args.SyncToken, "SyncToken");
      const response = (await getClient().get(
        `payment/${encodeURIComponent(paymentId)}`
      )) as {
        Payment?: { Id?: string; CustomerRef?: { value?: string; name?: string } };
      };
      if (String(response?.Payment?.Id) !== paymentId) {
        throw new Error(
          `Cannot verify payment ${paymentId}: the returned payment Id does not match the requested Id.`
        );
      }
      const existing = response?.Payment?.CustomerRef;
      if (!existing?.value) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Payment ${paymentId} has no CustomerRef to reuse. Pass CustomerRef (e.g. {"value": "123"}) along with Line.`,
            },
          ],
        };
      }
      const CustomerRef: { value: string; name?: string } = { value: existing.value };
      if (existing.name) CustomerRef.name = existing.name;
      return { fields: { CustomerRef } };
    },
  },
  void: {
    idParam: "paymentId",
    style: "include",
    note: "If this payment was included in a bank deposit, remove that deposit before QuickBooks will void it.",
  },
};
