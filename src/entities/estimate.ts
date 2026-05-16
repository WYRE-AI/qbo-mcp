/** Estimate entity config — non-posting quotes/proposals sent to customers. */

import type { EntityConfig, EntityField } from "./types.js";

const estimateFields: EntityField[] = [
  {
    name: "CustomerRef",
    type: "object",
    required: true,
    description: 'Customer being quoted, e.g. {"value": "123"}',
  },
  {
    name: "Line",
    type: "array",
    required: true,
    description:
      'Quote lines: {Amount, DetailType: "SalesItemLineDetail", SalesItemLineDetail: {ItemRef, Qty, UnitPrice}}.',
    items: { type: "object" },
  },
  { name: "TxnDate", type: "string", description: "Estimate date (YYYY-MM-DD)" },
  { name: "ExpirationDate", type: "string", description: "Expiration date" },
  {
    name: "AcceptedBy",
    type: "string",
    description: "Name of the customer contact who accepted",
  },
  { name: "AcceptedDate", type: "string", description: "Acceptance date" },
  {
    name: "TxnStatus",
    type: "string",
    description: 'Status: "Pending", "Accepted", "Rejected", or "Closed"',
  },
  { name: "DocNumber", type: "string", description: "Estimate number" },
  {
    name: "BillEmail",
    type: "object",
    description: 'Email address, e.g. {"Address": "customer@example.com"}',
  },
  { name: "PrivateNote", type: "string", description: "Private internal note" },
  {
    name: "CustomerMemo",
    type: "object",
    description: 'Memo visible to customer, e.g. {"value": "Thank you"}',
  },
];

export const estimateConfig: EntityConfig = {
  name: "Estimate",
  toolPrefix: "qbo_estimates",
  description: "Estimates - list, get, create, update quotes/proposals to customers",
  list: { dateRange: true },
  get: { idParam: "estimateId" },
  create: { fields: estimateFields },
  update: { idParam: "estimateId", fields: estimateFields },
};
