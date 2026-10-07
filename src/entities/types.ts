/**
 * Entity-config types for the QBO MCP generator.
 *
 * A QBO entity (Customer, Invoice, Vendor, ...) maps to a small set of
 * uniform REST operations: list, get, create, update, void, search. The shape of
 * each operation is identical across entities — only the entity name,
 * field set, and search field differ. EntityConfig captures that variation
 * declaratively so 140+ tools can be expressed as ~30 short configs.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export type EntityFieldType = "string" | "number" | "object" | "array" | "boolean";

/**
 * Field descriptor for create/update tool input schemas. The shape is a
 * discriminated union so `items` is required exactly when `type === "array"`
 * and forbidden otherwise — a stray `items` on a scalar field would emit
 * malformed JSON Schema and is now a type error.
 */
export type EntityField =
  | {
      name: string;
      description: string;
      required?: boolean;
      type: "string" | "number" | "boolean" | "object";
    }
  | {
      name: string;
      description: string;
      required?: boolean;
      type: "array";
      items: { type: Exclude<EntityFieldType, "array"> };
    };

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

/**
 * How QBO expects a void.
 *
 * - `operation`: `POST /{entity}?operation=void` — Invoice and most transactions.
 * - `include`: `POST /{entity}?operation=update&include=void` — Payment and
 *   SalesReceipt only. Intuit's PHP SDK (`PAYMENTCLASSNAME`) special-cases
 *   those two; `operation=void` on a Payment does not void it.
 *
 * Customer has neither void nor delete. Deactivate with a sparse update
 * setting `Active` to false.
 */
export type VoidStyle = "operation" | "include";

export interface VoidOp {
  idParam: string;
  style: VoidStyle;
  /** REST path segment. Defaults to the lowercased entity name. */
  pathSegment?: string;
  /** Extra sentence appended to the generated tool description. */
  note?: string;
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
  /**
   * Void, where the QBO Accounting API supports it. Not every entity does —
   * Customer in particular has no void or delete.
   */
  void?: VoidOp;
  search?: SearchOp;
}

/**
 * Result returned by a generated tool handler. Same shape MCP tool handlers
 * use across this codebase.
 */
export type ToolResult = {
  content: { type: "text"; text: string }[];
  /**
   * SEP-1865: the full entity payload (including any `_card` UI data),
   * distinct from the short human-readable summary in `content`.
   */
  structuredContent?: Record<string, unknown>;
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
