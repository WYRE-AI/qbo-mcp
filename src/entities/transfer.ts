/** Transfer entity config — moves funds between two bank/credit accounts. */

import type { EntityConfig, EntityField } from "./types.js";

const transferFields: EntityField[] = [
  {
    name: "FromAccountRef",
    type: "object",
    required: true,
    description: 'Source account, e.g. {"value": "35"}',
  },
  {
    name: "ToAccountRef",
    type: "object",
    required: true,
    description: 'Destination account, e.g. {"value": "37"}',
  },
  {
    name: "Amount",
    type: "number",
    required: true,
    description: "Amount transferred",
  },
  { name: "TxnDate", type: "string", description: "Transfer date (YYYY-MM-DD)" },
  { name: "PrivateNote", type: "string", description: "Memo" },
];

export const transferConfig: EntityConfig = {
  name: "Transfer",
  toolPrefix: "qbo_transfers",
  description: "Account transfers - list, get, create, update bank-to-bank transfers",
  list: { dateRange: true },
  get: { idParam: "transferId" },
  create: { fields: transferFields },
  update: { idParam: "transferId", fields: transferFields },
};
