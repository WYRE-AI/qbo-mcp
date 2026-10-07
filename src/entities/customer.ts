/**
 * Customer entity config. The list-with-no-args elicitation prompt can't be
 * expressed declaratively, so it lives in `extras.handlers` as an override.
 */

import { getClient } from "../utils/client.js";
import {
  assertPositiveInt,
  buildDatedListSql,
  buildLikeSearchSql,
  QBO_MAX_START_POSITION,
  type DatedListArgs,
} from "../utils/qbo-sql.js";
import { elicitText } from "../utils/elicitation.js";
import { jsonText } from "./generator.js";
import type { EntityConfig, EntityExtras, EntityField } from "./types.js";

const customerFields: EntityField[] = [
  {
    name: "DisplayName",
    type: "string",
    required: true,
    description: "Display name for the customer (required, must be unique)",
  },
  { name: "GivenName", type: "string", description: "First name of the customer" },
  { name: "FamilyName", type: "string", description: "Last name of the customer" },
  { name: "CompanyName", type: "string", description: "Company name" },
  {
    name: "PrimaryEmailAddr",
    type: "object",
    description:
      'Primary email address object, e.g. {"Address": "user@example.com"}',
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
];

const customerUpdateFields: EntityField[] = [
  ...customerFields,
  {
    name: "Active",
    type: "boolean",
    description:
      "Set to false to deactivate the customer. QuickBooks Online has no void or delete operation for Customer.",
  },
];

export const customerConfig: EntityConfig = {
  name: "Customer",
  toolPrefix: "qbo_customers",
  description:
    "Customer management - list, get, create, update, and search customers. QBO has no customer void or delete; set Active to false to deactivate.",
  list: {},
  get: { idParam: "customerId" },
  create: { fields: customerFields },
  update: { idParam: "customerId", fields: customerUpdateFields },
  search: { field: "DisplayName" },
};

export const customerExtras: EntityExtras = {
  handlers: {
    qbo_customers_list: async (args) => {
      const startPosition = assertPositiveInt(
        (args as DatedListArgs).startPosition ?? 1,
        "startPosition",
        { max: QBO_MAX_START_POSITION }
      );
      const maxResults = assertPositiveInt(
        (args as DatedListArgs).maxResults ?? 100,
        "maxResults"
      );

      let searchTerm: string | null = null;
      if (startPosition === 1 && maxResults === 100 && Object.keys(args).length === 0) {
        searchTerm = await elicitText(
          "Would you like to search for a specific customer? Enter a name, or leave blank to list all.",
          "searchTerm",
          "Enter a customer name to search for"
        );
      }

      let sql: string;
      if (searchTerm) {
        sql = buildLikeSearchSql("Customer", "DisplayName", searchTerm, {
          startPosition,
          maxResults,
        });
      } else {
        sql = buildDatedListSql("Customer", args as DatedListArgs);
      }
      return jsonText(await getClient().query(sql));
    },
  },
};
