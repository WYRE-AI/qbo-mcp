/** CreditMemo entity config — credits issued to customers (reduces AR). */

import type { EntityConfig, EntityField } from "./types.js";

const creditMemoFields: EntityField[] = [
  {
    name: "CustomerRef",
    type: "object",
    required: true,
    description: 'Customer receiving the credit, e.g. {"value": "123"}',
  },
  {
    name: "Line",
    type: "array",
    required: true,
    description:
      'Credit lines, same shape as Invoice.Line: {Amount, DetailType: "SalesItemLineDetail", SalesItemLineDetail: {ItemRef}}.',
    items: { type: "object" },
  },
  { name: "TxnDate", type: "string", description: "Credit date (YYYY-MM-DD)" },
  { name: "DocNumber", type: "string", description: "Credit memo number" },
  {
    name: "BillEmail",
    type: "object",
    description: 'Customer email, e.g. {"Address": "customer@example.com"}',
  },
  { name: "PrivateNote", type: "string", description: "Private note" },
  {
    name: "CustomerMemo",
    type: "object",
    description: 'Memo visible to customer, e.g. {"value": "Refund for damaged goods"}',
  },
];

export const creditMemoConfig: EntityConfig = {
  name: "CreditMemo",
  toolPrefix: "qbo_credit_memos",
  description: "Credit memos - list, get, create, update customer credits",
  list: { dateRange: true },
  get: { idParam: "creditMemoId" },
  create: { fields: creditMemoFields },
  update: { idParam: "creditMemoId", fields: creditMemoFields },
};
