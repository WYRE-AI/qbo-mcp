/**
 * Attachable entity config — file attachments + notes on transactions.
 *
 * The standard CRUD endpoints handle attachment *metadata* (filename,
 * content type, attached-to references, notes). Uploading the actual file
 * bytes uses a separate multipart /upload endpoint and is not exposed here;
 * callers that need to upload files should hit QBO directly with the
 * resulting Attachable Id.
 */

import type { EntityConfig, EntityField } from "./types.js";

const attachableFields: EntityField[] = [
  { name: "FileName", type: "string", description: "Original filename" },
  { name: "ContentType", type: "string", description: 'MIME type, e.g. "application/pdf"' },
  {
    name: "Note",
    type: "string",
    description: "Free-form text note (instead of a file)",
  },
  { name: "FileAccessUri", type: "string", description: "URI for accessing the file" },
  {
    name: "AttachableRef",
    type: "array",
    description:
      'Array of references attaching this to one or more transactions: [{EntityRef: {value, type}, IncludeOnSend: boolean}].',
    items: { type: "object" },
  },
  { name: "Category", type: "string", description: "User-defined category" },
];

export const attachableConfig: EntityConfig = {
  name: "Attachable",
  toolPrefix: "qbo_attachables",
  description:
    "Attachments and notes - list, get, create, update attachment metadata on transactions",
  list: {},
  get: { idParam: "attachableId" },
  create: { fields: attachableFields },
  update: { idParam: "attachableId", fields: attachableFields },
};
