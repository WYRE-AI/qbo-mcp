/**
 * Entity-config → Tool[] + handler generator.
 *
 * Each EntityConfig declaratively describes the QBO operations exposed for
 * one entity. generateEntityTools emits the Tool[] (one per declared op +
 * any extras). generateEntityHandler returns a dispatch function that
 * routes a tool-call by name to either a built-in CRUD handler or a
 * caller-supplied override.
 *
 * The generator owns the boilerplate that used to be hand-written in
 * src/domains/*.ts: pagination, date-range filtering, search escaping,
 * JSON response wrapping, error wrapping. Per-entity hand-written code
 * lives in EntityExtras (e.g. invoice send, customer-list elicitation).
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../utils/client.js";
import {
  assertPositiveInt,
  buildDatedListSql,
  escapeQboLike,
  escapeQboString,
  type DatedListArgs,
} from "../utils/qbo-sql.js";
import type {
  EntityConfig,
  EntityExtras,
  EntityField,
  ExtraHandler,
  ToolResult,
} from "./types.js";

function pathFor(config: EntityConfig, override?: string): string {
  return override ?? config.name.toLowerCase();
}

/**
 * Wrap an arbitrary value as the MCP tool-result shape every QBO tool
 * returns: a single text content block carrying pretty-printed JSON.
 * Exported so entity-extra handlers don't have to re-inline this shape.
 */
export function jsonText(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function fieldsToSchema(fields: EntityField[]): {
  properties: Record<string, object>;
  required: string[];
} {
  const properties: Record<string, object> = {};
  const required: string[] = [];
  for (const f of fields) {
    const prop: Record<string, unknown> = { type: f.type, description: f.description };
    if (f.type === "array") prop.items = f.items;
    properties[f.name] = prop;
    if (f.required) required.push(f.name);
  }
  return { properties, required };
}

export function generateEntityTools(config: EntityConfig): Tool[] {
  const tools: Tool[] = [];

  if (config.list) {
    const properties: Record<string, object> = {
      startPosition: {
        type: "number",
        description: "Starting position for pagination (1-based, default: 1)",
      },
      maxResults: {
        type: "number",
        description:
          "Maximum number of results to return (default: 100, max: 1000)",
      },
    };
    if (config.list.dateRange) {
      properties.startDate = {
        type: "string",
        description: "Filter to records on or after this TxnDate (YYYY-MM-DD)",
      };
      properties.endDate = {
        type: "string",
        description: "Filter to records on or before this TxnDate (YYYY-MM-DD)",
      };
    }
    tools.push({
      name: `${config.toolPrefix}_list`,
      description: `List ${config.name} records in QuickBooks Online with pagination${config.list.dateRange ? " and optional TxnDate range" : ""}.`,
      inputSchema: { type: "object", properties },
    });
  }

  if (config.get) {
    tools.push({
      name: `${config.toolPrefix}_get`,
      description: `Get a specific ${config.name} record by its ID.`,
      inputSchema: {
        type: "object",
        properties: {
          [config.get.idParam]: {
            type: "string",
            description: `The unique ${config.name} ID`,
          },
        },
        required: [config.get.idParam],
      },
    });
  }

  if (config.create) {
    const { properties, required } = fieldsToSchema(config.create.fields);
    tools.push({
      name: `${config.toolPrefix}_create`,
      description: `Create a new ${config.name} record in QuickBooks Online.`,
      inputSchema: { type: "object", properties, required },
    });
  }

  if (config.update) {
    const { properties, required } = fieldsToSchema(config.update.fields);
    // Id + SyncToken are always required for sparse update.
    properties[config.update.idParam] = {
      type: "string",
      description: `The ${config.name} ID to update`,
    };
    properties.SyncToken = {
      type: "string",
      description:
        "Current SyncToken of the record (required by QBO for sparse updates; fetch the record first to obtain it)",
    };
    tools.push({
      name: `${config.toolPrefix}_update`,
      description: `Sparse-update an existing ${config.name} record. Only provided fields are changed; Id and SyncToken are required.`,
      inputSchema: {
        type: "object",
        properties,
        required: [config.update.idParam, "SyncToken", ...required],
      },
    });
  }

  if (config.search) {
    tools.push({
      name: `${config.toolPrefix}_search`,
      description: `Search ${config.name} records by ${config.search.field} (LIKE match).`,
      inputSchema: {
        type: "object",
        properties: {
          term: {
            type: "string",
            description: `Search term matched against ${config.search.field} with LIKE '%term%'`,
          },
          startPosition: {
            type: "number",
            description: "Starting position for pagination (1-based, default: 1)",
          },
          maxResults: {
            type: "number",
            description:
              "Maximum number of results to return (default: 100, max: 1000)",
          },
        },
        required: ["term"],
      },
    });
  }

  return tools;
}

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;

/**
 * Build the lookup table of built-in handlers for one config. Each op closure
 * captures the bits it needs (path, idParam, field names) so the per-call
 * path is one map lookup + the closure body — no walking of the config tree
 * on the hot path.
 */
function builtinHandlers(config: EntityConfig): Map<string, Handler> {
  const map = new Map<string, Handler>();
  const prefix = config.toolPrefix;

  if (config.list) {
    map.set(`${prefix}_list`, async (args) => {
      const sql = buildDatedListSql(config.name, args as DatedListArgs);
      const result = await getClient().query(sql);
      return jsonText(result);
    });
  }

  if (config.get) {
    const { idParam } = config.get;
    const path = pathFor(config, config.get.pathSegment);
    map.set(`${prefix}_get`, async (args) => {
      const id = args[idParam] as string;
      const result = await getClient().get(`${path}/${id}`);
      return jsonText(result);
    });
  }

  if (config.create) {
    const path = pathFor(config, config.create.pathSegment);
    const fieldNames = config.create.fields.map((f) => f.name);
    map.set(`${prefix}_create`, async (args) => {
      const body: Record<string, unknown> = {};
      for (const k of fieldNames) {
        if (args[k] !== undefined) body[k] = args[k];
      }
      const result = await getClient().post(path, body);
      return jsonText(result);
    });
  }

  if (config.update) {
    const path = pathFor(config, config.update.pathSegment);
    const { idParam } = config.update;
    const fieldNames = config.update.fields.map((f) => f.name);
    map.set(`${prefix}_update`, async (args) => {
      const body: Record<string, unknown> = {
        Id: args[idParam] as string,
        SyncToken: args.SyncToken as string,
        sparse: true,
      };
      for (const k of fieldNames) {
        if (args[k] !== undefined) body[k] = args[k];
      }
      const result = await getClient().post(path, body);
      return jsonText(result);
    });
  }

  if (config.search) {
    const { field } = config.search;
    map.set(`${prefix}_search`, async (args) => {
      const rawTerm = args.term as string;
      // LIKE-escape first so user `%`/`_` becomes literal, then quote-escape
      // for SQL string-literal safety. ESCAPE '\\' tells QBO that backslash
      // is the wildcard-escape character.
      const term = escapeQboString(escapeQboLike(rawTerm));
      const startPosition = assertPositiveInt(args.startPosition ?? 1, "startPosition");
      const maxResults = assertPositiveInt(args.maxResults ?? 100, "maxResults");
      const sql = `SELECT * FROM ${config.name} WHERE ${field} LIKE '%${term}%' ESCAPE '\\' STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
      const result = await getClient().query(sql);
      return jsonText(result);
    });
  }

  return map;
}

/**
 * Return all tools (generated + extras) for one entity config.
 */
export function entityTools(config: EntityConfig, extras?: EntityExtras): Tool[] {
  return [...generateEntityTools(config), ...(extras?.tools ?? [])];
}

export type EntityDispatcher = (
  toolName: string,
  args: Record<string, unknown>
) => Promise<ToolResult | null>;

/**
 * Build a dispatcher for one entity. The handler table is constructed once
 * here and captured in the returned closure, so each tool-call is a single
 * map lookup. Returns null when the tool name doesn't belong to this entity,
 * so the registry can keep walking.
 */
export function makeEntityDispatcher(
  config: EntityConfig,
  extras?: EntityExtras
): EntityDispatcher {
  const overrides: Record<string, ExtraHandler> = extras?.handlers ?? {};
  const builtins = builtinHandlers(config);

  return async (toolName, args) => {
    const override = overrides[toolName];
    if (override) return override(args);

    const handler = builtins.get(toolName);
    if (!handler) return null;
    return handler(args);
  };
}
