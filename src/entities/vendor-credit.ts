/** VendorCredit entity config — credits issued by vendors against bills. */

import type { EntityConfig, EntityField } from "./types.js";

const vendorCreditFields: EntityField[] = [
  {
    name: "VendorRef",
    type: "object",
    required: true,
    description: 'Vendor reference, e.g. {"value": "56"} (required)',
  },
  {
    name: "Line",
    type: "array",
    required: true,
    description:
      'Array of credit lines, same shape as Bill.Line: {Amount, DetailType: "AccountBasedExpenseLineDetail" | "ItemBasedExpenseLineDetail", ...}.',
    items: { type: "object" },
  },
  {
    name: "TxnDate",
    type: "string",
    description: "Credit date (YYYY-MM-DD); defaults to today if omitted",
  },
  {
    name: "DocNumber",
    type: "string",
    description: "Reference number from the vendor",
  },
  {
    name: "PrivateNote",
    type: "string",
    description: "Private note",
  },
  {
    name: "APAccountRef",
    type: "object",
    description: 'Accounts Payable account reference, e.g. {"value": "33"}',
  },
];

export const vendorCreditConfig: EntityConfig = {
  name: "VendorCredit",
  toolPrefix: "qbo_vendor_credits",
  description:
    "Vendor credits - list, get, create, and update credits from vendors",
  list: { dateRange: true },
  get: { idParam: "vendorCreditId" },
  create: { fields: vendorCreditFields },
  update: { idParam: "vendorCreditId", fields: vendorCreditFields },
};
