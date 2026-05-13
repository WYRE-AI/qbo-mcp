/**
 * TaxRate entity config — read-only.
 *
 * Tax rates are created indirectly via the TaxService endpoint, not direct
 * POST to /taxrate. Exposed here for list/get/search only.
 */

import type { EntityConfig } from "./types.js";

export const taxRateConfig: EntityConfig = {
  name: "TaxRate",
  toolPrefix: "qbo_tax_rates",
  description: "Tax rates - list, get, and search (read-only)",
  list: {},
  get: { idParam: "taxRateId" },
  search: { field: "Name" },
};
