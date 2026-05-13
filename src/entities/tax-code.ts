/**
 * TaxCode entity config — read-only.
 *
 * Tax codes are managed through QBO's automated sales tax engine or
 * region-specific endpoints; the standard /taxcode endpoint does not
 * support arbitrary create/update from the v3 API.
 */

import type { EntityConfig } from "./types.js";

export const taxCodeConfig: EntityConfig = {
  name: "TaxCode",
  toolPrefix: "qbo_tax_codes",
  description: "Tax codes - list, get, and search (read-only)",
  list: {},
  get: { idParam: "taxCodeId" },
  search: { field: "Name" },
};
