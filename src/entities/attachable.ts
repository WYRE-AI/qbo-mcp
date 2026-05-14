/**
 * Attachable entity config — file attachments + notes on transactions.
 *
 * The standard CRUD endpoints (list/get/create/update) handle attachment
 * *metadata*. Uploading the actual file bytes is a separate multipart
 * endpoint, exposed as the extra `qbo_attachables_upload` tool below.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../utils/client.js";
import { jsonText } from "./generator.js";
import type { EntityConfig, EntityExtras, EntityField } from "./types.js";

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
    "Attachments and notes - list, get, create, update attachment metadata, and upload files on transactions",
  list: {},
  get: { idParam: "attachableId" },
  create: { fields: attachableFields },
  update: { idParam: "attachableId", fields: attachableFields },
};

const uploadTool: Tool = {
  name: "qbo_attachables_upload",
  description:
    "Upload a file to QuickBooks Online and (optionally) attach it to a transaction. Returns the created Attachable record. File bytes must be provided base64-encoded; QBO's max attachment size is 100 MB per file.",
  inputSchema: {
    type: "object",
    properties: {
      fileName: {
        type: "string",
        description: 'Original filename including extension, e.g. "invoice-1234.pdf"',
      },
      contentType: {
        type: "string",
        description: 'MIME type of the file, e.g. "application/pdf" or "image/png"',
      },
      base64Data: {
        type: "string",
        description: "Base64-encoded file content",
      },
      note: {
        type: "string",
        description: "Optional free-form note stored on the Attachable",
      },
      category: {
        type: "string",
        description: 'Optional user-defined category, e.g. "Receipt", "Contract"',
      },
      attachToType: {
        type: "string",
        description:
          'Optional QBO entity type to attach this file to, e.g. "Invoice", "Bill", "Customer"',
      },
      attachToId: {
        type: "string",
        description: "Optional QBO entity ID to attach this file to",
      },
      includeOnSend: {
        type: "boolean",
        description:
          "Optional. When true and attached to a sendable entity (Invoice, Estimate), include this file when the entity is sent by email. Defaults to false.",
      },
    },
    required: ["fileName", "contentType", "base64Data"],
  },
};

/**
 * Build the JSON metadata QBO expects for one file in the multipart upload.
 * Exported so the unit test can assert on its exact shape without round-
 * tripping through FormData.
 */
export function buildAttachableMetadata(args: {
  fileName: string;
  contentType: string;
  note?: string;
  category?: string;
  attachToType?: string;
  attachToId?: string;
  includeOnSend?: boolean;
}): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    AttachableRef: [] as Array<Record<string, unknown>>,
    FileName: args.fileName,
    ContentType: args.contentType,
  };
  if (args.note) metadata.Note = args.note;
  if (args.category) metadata.Category = args.category;
  if (args.attachToType && args.attachToId) {
    (metadata.AttachableRef as Array<Record<string, unknown>>).push({
      EntityRef: { type: args.attachToType, value: args.attachToId },
      IncludeOnSend: Boolean(args.includeOnSend),
    });
  }
  return metadata;
}

export const attachableExtras: EntityExtras = {
  tools: [uploadTool],
  handlers: {
    qbo_attachables_upload: async (args) => {
      const a = args as {
        fileName: string;
        contentType: string;
        base64Data: string;
        note?: string;
        category?: string;
        attachToType?: string;
        attachToId?: string;
        includeOnSend?: boolean;
      };

      const metadata = buildAttachableMetadata(a);
      const fileBuffer = Buffer.from(a.base64Data, "base64");

      // QBO's /upload accepts multiple file_metadata_NN + file_content_NN
      // pairs in one request. We only ever upload one at a time from MCP;
      // the _00 suffix is the convention for that single pair.
      const form = new FormData();
      form.append(
        "file_metadata_00",
        new Blob([JSON.stringify(metadata)], { type: "application/json" }),
      );
      form.append(
        "file_content_00",
        new Blob([fileBuffer], { type: a.contentType }),
        a.fileName,
      );

      return jsonText(await getClient().postMultipart("upload", form));
    },
  },
};
