/**
 * JournalEntry entity config — debits/credits that must balance.
 *
 * Each Line item must have DetailType "JournalEntryLineDetail" with a
 * JournalEntryLineDetail object specifying PostingType ("Debit" or "Credit")
 * and an AccountRef. Total debits must equal total credits across all lines.
 */

import type { EntityConfig, EntityField } from "./types.js";

const journalEntryFields: EntityField[] = [
  {
    name: "Line",
    type: "array",
    required: true,
    description:
      'Array of journal entry lines. Each line: {Amount, DetailType: "JournalEntryLineDetail", JournalEntryLineDetail: {PostingType: "Debit"|"Credit", AccountRef: {value: "id"}, Entity?: {EntityRef: {value, type}}}}. Total debits must equal total credits.',
    items: { type: "object" },
  },
  {
    name: "TxnDate",
    type: "string",
    description: "Transaction date (YYYY-MM-DD); defaults to today if omitted",
  },
  {
    name: "DocNumber",
    type: "string",
    description: "Reference number for the journal entry",
  },
  {
    name: "PrivateNote",
    type: "string",
    description: "Private memo (not visible on reports)",
  },
  {
    name: "Adjustment",
    type: "boolean",
    description: "Whether this is an adjusting journal entry",
  },
];

export const journalEntryConfig: EntityConfig = {
  name: "JournalEntry",
  toolPrefix: "qbo_journal_entries",
  description:
    "Journal entries - list, get, create, update double-entry debit/credit transactions",
  list: { dateRange: true },
  get: { idParam: "journalEntryId" },
  create: { fields: journalEntryFields },
  update: { idParam: "journalEntryId", fields: journalEntryFields },
};
