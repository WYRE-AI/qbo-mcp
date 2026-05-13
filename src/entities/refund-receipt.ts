/** RefundReceipt entity config — cash refunds paid to customers. */

import type { EntityConfig, EntityField } from "./types.js";

const refundReceiptFields: EntityField[] = [
  {
    name: "CustomerRef",
    type: "object",
    required: true,
    description: 'Customer receiving the refund, e.g. {"value": "123"}',
  },
  {
    name: "Line",
    type: "array",
    required: true,
    description:
      'Refund lines, same shape as Invoice.Line: {Amount, DetailType: "SalesItemLineDetail", SalesItemLineDetail: {ItemRef}}.',
    items: { type: "object" },
  },
  {
    name: "DepositToAccountRef",
    type: "object",
    required: true,
    description:
      'Account the refund is drawn from, e.g. {"value": "35"} (required)',
  },
  {
    name: "PaymentMethodRef",
    type: "object",
    description: 'Payment method used to issue refund, e.g. {"value": "1"}',
  },
  { name: "TxnDate", type: "string", description: "Refund date (YYYY-MM-DD)" },
  { name: "DocNumber", type: "string", description: "Refund number" },
  { name: "PrivateNote", type: "string", description: "Private note" },
  {
    name: "CustomerMemo",
    type: "object",
    description: 'Memo visible to customer',
  },
];

export const refundReceiptConfig: EntityConfig = {
  name: "RefundReceipt",
  toolPrefix: "qbo_refund_receipts",
  description: "Refund receipts - list, get, create, update cash refunds to customers",
  list: { dateRange: true },
  get: { idParam: "refundReceiptId" },
  create: { fields: refundReceiptFields },
  update: { idParam: "refundReceiptId", fields: refundReceiptFields },
};
