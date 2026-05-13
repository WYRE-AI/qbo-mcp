/** PurchaseOrder entity config — non-posting purchase orders sent to vendors. */

import type { EntityConfig, EntityField } from "./types.js";

const purchaseOrderFields: EntityField[] = [
  {
    name: "VendorRef",
    type: "object",
    required: true,
    description: 'Vendor receiving the PO, e.g. {"value": "56"}',
  },
  {
    name: "Line",
    type: "array",
    required: true,
    description:
      'PO lines, same shape as Bill.Line: {Amount, DetailType, AccountBasedExpenseLineDetail | ItemBasedExpenseLineDetail}.',
    items: { type: "object" },
  },
  { name: "TxnDate", type: "string", description: "PO date (YYYY-MM-DD)" },
  { name: "DueDate", type: "string", description: "Expected delivery date" },
  { name: "DocNumber", type: "string", description: "PO number" },
  {
    name: "POStatus",
    type: "string",
    description: 'Status: "Open" or "Closed"',
  },
  {
    name: "ShipAddr",
    type: "object",
    description: "Ship-to address (Line1, City, CountrySubDivisionCode, PostalCode)",
  },
  {
    name: "VendorAddr",
    type: "object",
    description: "Vendor address override",
  },
  { name: "Memo", type: "string", description: "Memo printed on the PO" },
  { name: "PrivateNote", type: "string", description: "Private internal note" },
];

export const purchaseOrderConfig: EntityConfig = {
  name: "PurchaseOrder",
  toolPrefix: "qbo_purchase_orders",
  description:
    "Purchase orders - list, get, create, update non-posting POs to vendors",
  list: { dateRange: true },
  get: { idParam: "purchaseOrderId" },
  create: { fields: purchaseOrderFields },
  update: { idParam: "purchaseOrderId", fields: purchaseOrderFields },
};
