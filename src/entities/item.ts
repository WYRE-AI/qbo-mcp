/** Item entity config — products and services. */

import type { EntityConfig, EntityField } from "./types.js";

const itemFields: EntityField[] = [
  {
    name: "Name",
    type: "string",
    required: true,
    description: "Item name (required, must be unique)",
  },
  {
    name: "Type",
    type: "string",
    description:
      "Item type: Inventory, NonInventory, or Service. Required on create unless QBO infers it.",
  },
  { name: "UnitPrice", type: "number", description: "Default sales price" },
  {
    name: "PurchaseCost",
    type: "number",
    description: "Default purchase cost",
  },
  { name: "Description", type: "string", description: "Sales description" },
  {
    name: "PurchaseDesc",
    type: "string",
    description: "Purchase-side description",
  },
  {
    name: "IncomeAccountRef",
    type: "object",
    description:
      'Income account reference, e.g. {"value": "79"} (required for Inventory and Service items)',
  },
  {
    name: "ExpenseAccountRef",
    type: "object",
    description:
      'Expense or COGS account reference, e.g. {"value": "80"} (required for Inventory and NonInventory items)',
  },
  {
    name: "AssetAccountRef",
    type: "object",
    description:
      'Asset account reference, required for Inventory items, e.g. {"value": "81"}',
  },
  {
    name: "QtyOnHand",
    type: "number",
    description: "Initial on-hand quantity (Inventory items only)",
  },
  {
    name: "InvStartDate",
    type: "string",
    description: "Inventory start date (YYYY-MM-DD, Inventory items only)",
  },
  {
    name: "Taxable",
    type: "boolean",
    description: "Whether the item is taxable on sales",
  },
];

export const itemConfig: EntityConfig = {
  name: "Item",
  toolPrefix: "qbo_items",
  description:
    "Item management - list, get, create, update, and search products and services",
  list: {},
  get: { idParam: "itemId" },
  create: { fields: itemFields },
  update: { idParam: "itemId", fields: itemFields },
  search: { field: "Name" },
};
