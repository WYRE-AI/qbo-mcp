/**
 * SalesReceipt entity config — paid-at-sale customer transactions.
 *
 * Distinct from Invoice: SalesReceipt records a sale that was paid in the
 * same transaction. There is no separate Payment.
 */

import type { EntityConfig, EntityField } from "./types.js";

const salesReceiptFields: EntityField[] = [
  {
    name: "CustomerRef",
    type: "object",
    required: true,
    description: 'Customer reference, e.g. {"value": "123"}',
  },
  {
    name: "Line",
    type: "array",
    required: true,
    description:
      'Sale lines: {Amount, DetailType: "SalesItemLineDetail", SalesItemLineDetail: {ItemRef}}.',
    items: { type: "object" },
  },
  {
    name: "DepositToAccountRef",
    type: "object",
    description:
      'Account where the payment is deposited, e.g. {"value": "35"}. Required unless using Undeposited Funds default.',
  },
  {
    name: "PaymentMethodRef",
    type: "object",
    description: 'Payment method, e.g. {"value": "1"}',
  },
  { name: "TxnDate", type: "string", description: "Sale date (YYYY-MM-DD)" },
  { name: "DocNumber", type: "string", description: "Receipt number" },
  {
    name: "BillEmail",
    type: "object",
    description: 'Customer email, e.g. {"Address": "customer@example.com"}',
  },
  { name: "PrivateNote", type: "string", description: "Private internal note" },
  {
    name: "CustomerMemo",
    type: "object",
    description: 'Memo visible to customer, e.g. {"value": "Thank you"}',
  },
];

export const salesReceiptConfig: EntityConfig = {
  name: "SalesReceipt",
  toolPrefix: "qbo_sales_receipts",
  description:
    "Sales receipts - list, get, create, update paid-at-sale customer transactions",
  list: { dateRange: true },
  get: { idParam: "salesReceiptId" },
  create: { fields: salesReceiptFields },
  update: { idParam: "salesReceiptId", fields: salesReceiptFields },
};
