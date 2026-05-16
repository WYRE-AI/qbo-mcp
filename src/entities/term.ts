/** Term entity config — payment terms (e.g. Net 30, 2/10 Net 30). */

import type { EntityConfig, EntityField } from "./types.js";

const termFields: EntityField[] = [
  {
    name: "Name",
    type: "string",
    required: true,
    description: "Term name, e.g. \"Net 30\"",
  },
  {
    name: "DueDays",
    type: "number",
    description: "Number of days from invoice date to due date",
  },
  {
    name: "DiscountPercent",
    type: "number",
    description: "Early-payment discount percent (for 2/10 Net 30 style terms)",
  },
  {
    name: "DiscountDays",
    type: "number",
    description: "Days within which the discount applies",
  },
  { name: "Active", type: "boolean", description: "Whether the term is active" },
];

export const termConfig: EntityConfig = {
  name: "Term",
  toolPrefix: "qbo_terms",
  description: "Payment terms - list, get, create, update terms like Net 30",
  list: {},
  get: { idParam: "termId" },
  create: { fields: termFields },
  update: { idParam: "termId", fields: termFields },
  search: { field: "Name" },
};
