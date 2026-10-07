/**
 * Payment entity config.
 *
 * Void uses `operation=update&include=void`. That is the Payment (and
 * SalesReceipt) form documented by Intuit and special-cased in the official
 * PHP SDK; `?operation=void` does not void a Payment.
 */

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
      'Bank or asset account to deposit this payment into, e.g. {"value": "35"}. Omit to use Undeposited Funds.',
  },
  {
    name: "Line",
    type: "array",
    description:
      "Linked transactions applying this payment, e.g. [{Amount: 100, LinkedTxn: [{TxnId: '5', TxnType: 'Invoice'}]}]. On update, Line replaces existing applications. QuickBooks keeps one line per invoice: a second line for an invoice that is already linked replaces that amount instead of adding to it. To increase an application, send one line with the combined amount.",
    items: { type: "object" },
  },
];

export const paymentConfig: EntityConfig = {
  name: "Payment",
  toolPrefix: "qbo_payments",
  description:
    "Payment management - list, get, create, update, and void payments linked to invoices",
  list: { dateRange: true },
  get: { idParam: "paymentId" },
  create: { fields: paymentFields },
  update: { idParam: "paymentId", fields: paymentFields },
  void: {
    idParam: "paymentId",
    style: "include",
    note: "If this payment was included in a bank deposit, remove that deposit before QuickBooks will void it.",
  },
};
