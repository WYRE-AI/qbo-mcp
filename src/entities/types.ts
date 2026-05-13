/**
 * Entity-config types for the QBO MCP generator.
 *
 * A QBO entity (Customer, Invoice, Vendor, ...) maps to a small set of
 * uniform REST operations: list, get, create, update, search. The shape of
 * each operation is identical across entities — only the entity name,
 * field set, and search field differ. EntityConfig captures that variation
 * declaratively so 140+ tools can be expressed as ~30 short configs.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export type EntityFieldType = "string" | "number" | "object" | "array" | "boolean";

export interface EntityField {
  name: string;
  type: EntityFieldType;
  required?: boolean;
  description: string;
  /** For array fields: schema of each item (passed through verbatim). */
  items?: { type: EntityFieldType };
}

export interface ListOp {
  /** If true, list tool accepts startDate/endDate filtering on TxnDate. */
  dateRange?: boolean;
}

export interface GetOp {
  /** Name of the id parameter on the get tool, e.g. "customerId". */
  idParam: string;
  /**
   * REST path segment for GET requests. Defaults to the lowercased entity
   * name. Override only when QBO's URL doesn't follow the convention.
   */
  pathSegment?: string;
}

export interface CreateOp {
  fields: EntityField[];
  /** REST path segment for POST. Defaults to lowercased entity name. */
  pathSegment?: string;
}

export interface UpdateOp {
  /**
   * Update is sparse-update via POST with Id + SyncToken + sparse:true. The
   * caller passes a partial entity; we add `sparse: true` server-side.
   * The fields here describe what *can* be updated; Id and SyncToken are
   * always required and added automatically.
   */
  fields: EntityField[];
  idParam: string;
  pathSegment?: string;
}

export interface SearchOp {
  /** QBO column to LIKE-search on, e.g. "DisplayName". */
  field: string;
}

export interface EntityConfig {
  /** QBO entity name in PascalCase, used verbatim in SQL (e.g. "Customer"). */
  name: string;
  /** Tool-name prefix, e.g. "qbo_customers". Tools become {prefix}_{op}. */
  toolPrefix: string;
  /** One-line description used by qbo_navigate for this domain. */
  description: string;
  list?: ListOp;
  get?: GetOp;
  create?: CreateOp;
  update?: UpdateOp;
  search?: SearchOp;
}

/**
 * Result returned by a generated tool handler. Same shape MCP tool handlers
 * use across this codebase.
 */
export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/**
 * Optional per-tool hook. When set, the generator calls the hook *instead of*
 * its built-in handler for the matching tool name. Used for tools that need
 * elicitation, custom filters, or other non-CRUD behavior (e.g. invoice send,
 * customer-list-with-elicitation).
 */
export type ExtraHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

export interface EntityExtras {
  /** Extra Tool[] to merge into the entity's tool list. */
  tools?: Tool[];
  /** Handler overrides keyed by full tool name. */
  handlers?: Record<string, ExtraHandler>;
}
