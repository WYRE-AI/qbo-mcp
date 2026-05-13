/** Account entity config — chart of accounts. Required for journal entries. */

import type { EntityConfig, EntityField } from "./types.js";

const accountFields: EntityField[] = [
  {
    name: "Name",
    type: "string",
    required: true,
    description: "Account name (required, must be unique within parent)",
  },
  {
    name: "AccountType",
    type: "string",
    description:
      "High-level account type, e.g. Bank, Accounts Receivable, Income, Expense, Equity, Other Current Asset (required on create)",
  },
  {
    name: "AccountSubType",
    type: "string",
    description:
      "Specific sub-type within the AccountType, e.g. Checking, SalesOfProductIncome",
  },
  {
    name: "AcctNum",
    type: "string",
    description: "User-defined account number (if chart-of-accounts numbering is enabled)",
  },
  { name: "Description", type: "string", description: "Free-form description" },
  {
    name: "CurrencyRef",
    type: "object",
    description:
      'Currency reference for multi-currency companies, e.g. {"value": "USD"}',
  },
  {
    name: "ParentRef",
    type: "object",
    description: 'Parent account reference for sub-accounts, e.g. {"value": "42"}',
  },
  {
    name: "Active",
    type: "boolean",
    description: "Whether the account is active (inactive accounts are hidden)",
  },
];

export const accountConfig: EntityConfig = {
  name: "Account",
  toolPrefix: "qbo_accounts",
  description:
    "Chart of accounts - list, get, create, update, and search accounts",
  list: {},
  get: { idParam: "accountId" },
  create: { fields: accountFields },
  update: { idParam: "accountId", fields: accountFields },
  search: { field: "Name" },
};
