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
  // US companies expose the pseudo tax codes TAX and NON (and CustomSalesTax
  // under automated sales tax). In a 2026-10-29 sandbox check, every other
  // entity listed (TaxRate, Term, Department, Class, PaymentMethod, Account,
  // Item, Employee, Vendor, Customer, CompanyInfo, TaxAgency) returned only
  // numeric Ids. QBO's own GET /taxcode/TAX currently answers 400 code 2030
  // "Id should be a valid number". We accept TAX/NON so the caller gets QBO's
  // answer rather than a local rejection.
  idPattern: /^(?:\d+|TAX|NON)$/,
  list: {},
  get: { idParam: "taxCodeId" },
  search: { field: "Name" },
};
