/** Vendor entity config — companies/people you pay. Mirrors Customer shape. */

import type { EntityConfig, EntityField } from "./types.js";

const vendorFields: EntityField[] = [
  {
    name: "DisplayName",
    type: "string",
    required: true,
    description: "Display name for the vendor (required, must be unique)",
  },
  { name: "GivenName", type: "string", description: "First name" },
  { name: "FamilyName", type: "string", description: "Last name" },
  { name: "CompanyName", type: "string", description: "Company name" },
  {
    name: "PrimaryEmailAddr",
    type: "object",
    description: 'Primary email address object, e.g. {"Address": "vendor@example.com"}',
  },
  {
    name: "PrimaryPhone",
    type: "object",
    description: 'Primary phone object, e.g. {"FreeFormNumber": "555-1234"}',
  },
  {
    name: "BillAddr",
    type: "object",
    description:
      "Billing address object with Line1, City, CountrySubDivisionCode, PostalCode",
  },
  {
    name: "Vendor1099",
    type: "boolean",
    description: "Whether this vendor receives a 1099 at year end",
  },
  {
    name: "TaxIdentifier",
    type: "string",
    description: "Tax ID (e.g. EIN or SSN) used for 1099 reporting",
  },
];

export const vendorConfig: EntityConfig = {
  name: "Vendor",
  toolPrefix: "qbo_vendors",
  description: "Vendor management - list, get, create, update, and search vendors",
  list: {},
  get: { idParam: "vendorId" },
  create: { fields: vendorFields },
  update: { idParam: "vendorId", fields: vendorFields },
  search: { field: "DisplayName" },
};
