/**
 * Bill entity config — vendor bills payable.
 *
 * The legacy `qbo_expenses_list_bills` / `qbo_expenses_get_bill` tools in
 * src/domains/expenses.ts remain for backwards compatibility. New work
 * should use these `qbo_bills_*` tools, which add create + update + search.
 */

import type { EntityConfig, EntityField } from "./types.js";

const billFields: EntityField[] = [
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
      'Array of bill lines. Each line: {Amount, DetailType: "AccountBasedExpenseLineDetail" | "ItemBasedExpenseLineDetail", AccountBasedExpenseLineDetail?: {AccountRef: {value}}, ItemBasedExpenseLineDetail?: {ItemRef: {value}, Qty, UnitPrice}}.',
    items: { type: "object" },
  },
  {
    name: "TxnDate",
    type: "string",
    description: "Bill date (YYYY-MM-DD); defaults to today if omitted",
  },
  {
    name: "DueDate",
    type: "string",
    description: "Due date (YYYY-MM-DD)",
  },
  {
    name: "DocNumber",
    type: "string",
    description: "Reference number / bill number from the vendor",
  },
  {
    name: "PrivateNote",
    type: "string",
    description: "Private note (not visible to vendor)",
  },
  {
    name: "APAccountRef",
    type: "object",
    description: 'Accounts Payable account reference, e.g. {"value": "33"}',
  },
];

export const billConfig: EntityConfig = {
  name: "Bill",
  toolPrefix: "qbo_bills",
  description:
    "Bills - list, get, create, update, and search vendor bills (accounts payable)",
  list: { dateRange: true },
  get: { idParam: "billId" },
  create: { fields: billFields },
  update: { idParam: "billId", fields: billFields },
  search: { field: "DocNumber" },
};
