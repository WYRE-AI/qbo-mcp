/**
 * Customer entity config.
 *
 * Migrated from src/domains/customers.ts. The list-with-no-args elicitation
 * prompt is the one piece of hand-written behavior — it can't be expressed
 * declaratively, so it lives in `extras.handlers` as an override on the
 * generated list handler.
 */

import { getClient } from "../utils/client.js";
import {
  assertPositiveInt,
  buildDatedListSql,
  escapeQboString,
  type DatedListArgs,
} from "../utils/qbo-sql.js";
import { elicitText } from "../utils/elicitation.js";
import type { EntityConfig, EntityExtras } from "./types.js";

export const customerConfig: EntityConfig = {
  name: "Customer",
  toolPrefix: "qbo_customers",
  description:
    "Customer management - list, get, create, and search customers",
  list: {},
  get: { idParam: "customerId" },
  create: {
    fields: [
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
    ],
  },
  search: { field: "DisplayName" },
};

export const customerExtras: EntityExtras = {
  handlers: {
    qbo_customers_list: async (args) => {
      const startPosition = assertPositiveInt(
        (args as DatedListArgs).startPosition ?? 1,
        "startPosition"
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
        sql = `SELECT * FROM Customer WHERE DisplayName LIKE '%${escapeQboString(searchTerm)}%' STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
      } else {
        sql = buildDatedListSql("Customer", args as DatedListArgs);
      }
      const result = await getClient().query(sql);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  },
};
