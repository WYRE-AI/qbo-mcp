/**
 * Deposit entity config — bank deposits aggregating one or more receipts.
 *
 * Lines either reference linked transactions (LinkedTxn from Undeposited
 * Funds) or are direct deposit lines (DepositLineDetail with AccountRef).
 */

import type { EntityConfig, EntityField } from "./types.js";

const depositFields: EntityField[] = [
  {
    name: "DepositToAccountRef",
    type: "object",
    required: true,
    description: 'Bank account receiving the deposit, e.g. {"value": "35"}',
  },
  {
    name: "Line",
    type: "array",
    required: true,
    description:
      'Deposit lines. Each line is either {Amount, DetailType: "DepositLineDetail", DepositLineDetail: {AccountRef, Entity?, PaymentMethodRef?}} OR {Amount, LinkedTxn: [{TxnId, TxnType}]} for linked transactions.',
    items: { type: "object" },
  },
  { name: "TxnDate", type: "string", description: "Deposit date (YYYY-MM-DD)" },
  { name: "DocNumber", type: "string", description: "Deposit reference number" },
  { name: "PrivateNote", type: "string", description: "Private note" },
  {
    name: "CashBack",
    type: "object",
    description:
      'Optional cash-back amount: {Amount, AccountRef: {value}, Memo?}',
  },
];

export const depositConfig: EntityConfig = {
  name: "Deposit",
  toolPrefix: "qbo_deposits",
  description: "Bank deposits - list, get, create, update deposits aggregating receipts",
  list: { dateRange: true },
  get: { idParam: "depositId" },
  create: { fields: depositFields },
  update: { idParam: "depositId", fields: depositFields },
};
