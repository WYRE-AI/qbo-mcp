/**
 * Purchase entity config — direct expenses (debit/credit card, cash) paid at
 * point of purchase, distinct from Bill which is payable to a vendor later.
 * Legacy qbo_expenses_list_purchases / qbo_expenses_get_purchase remain for
 * backwards compat.
 */

import type { EntityConfig, EntityField } from "./types.js";

const purchaseFields: EntityField[] = [
  {
    name: "AccountRef",
    type: "object",
    required: true,
    description:
      'Bank, credit card, or cash account the purchase was paid from, e.g. {"value": "35"}',
  },
  {
    name: "PaymentType",
    type: "string",
    required: true,
    description: 'Payment method: "Cash", "Check", or "CreditCard"',
  },
  {
    name: "Line",
    type: "array",
    required: true,
    description:
      'Expense lines, same shape as Bill.Line: {Amount, DetailType: "AccountBasedExpenseLineDetail" | "ItemBasedExpenseLineDetail", ...}.',
    items: { type: "object" },
  },
  {
    name: "EntityRef",
    type: "object",
    description:
      'Optional payee reference, e.g. {"value": "56", "type": "Vendor"} or with type "Customer"/"Employee"',
  },
  { name: "TxnDate", type: "string", description: "Purchase date (YYYY-MM-DD)" },
  { name: "DocNumber", type: "string", description: "Reference number" },
  { name: "PrivateNote", type: "string", description: "Private note" },
];

export const purchaseConfig: EntityConfig = {
  name: "Purchase",
  toolPrefix: "qbo_purchases",
  description:
    "Direct expense purchases - list, get, create, update purchases paid at point of sale",
  list: { dateRange: true },
  get: { idParam: "purchaseId" },
  create: { fields: purchaseFields },
  update: { idParam: "purchaseId", fields: purchaseFields },
};
