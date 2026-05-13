/**
 * BillPayment entity config — payments made against bills.
 *
 * PayType determines which sub-detail is required: "Check" requires
 * CheckPayment with BankAccountRef; "CreditCard" requires CreditCardPayment
 * with CCAccountRef.
 */

import type { EntityConfig, EntityField } from "./types.js";

const billPaymentFields: EntityField[] = [
  {
    name: "VendorRef",
    type: "object",
    required: true,
    description: 'Vendor reference, e.g. {"value": "56"} (required)',
  },
  {
    name: "TotalAmt",
    type: "number",
    required: true,
    description: "Total payment amount across all linked bills (required)",
  },
  {
    name: "PayType",
    type: "string",
    required: true,
    description: 'Payment method: "Check" or "CreditCard" (required)',
  },
  {
    name: "Line",
    type: "array",
    required: true,
    description:
      'Array of LinkedTxn entries: [{Amount, LinkedTxn: [{TxnId: "billId", TxnType: "Bill"}]}].',
    items: { type: "object" },
  },
  {
    name: "TxnDate",
    type: "string",
    description: "Payment date (YYYY-MM-DD); defaults to today if omitted",
  },
  {
    name: "DocNumber",
    type: "string",
    description: "Reference number (e.g. check number)",
  },
  {
    name: "CheckPayment",
    type: "object",
    description:
      'Required when PayType is "Check". Shape: {BankAccountRef: {value}, PrintStatus: "NeedToPrint"|"PrintComplete"}',
  },
  {
    name: "CreditCardPayment",
    type: "object",
    description:
      'Required when PayType is "CreditCard". Shape: {CCAccountRef: {value}}',
  },
  {
    name: "PrivateNote",
    type: "string",
    description: "Private note",
  },
];

export const billPaymentConfig: EntityConfig = {
  name: "BillPayment",
  toolPrefix: "qbo_bill_payments",
  description: "Bill payments - list, get, create, and update payments against bills",
  list: { dateRange: true },
  get: { idParam: "billPaymentId" },
  create: { fields: billPaymentFields },
  update: { idParam: "billPaymentId", fields: billPaymentFields },
};
