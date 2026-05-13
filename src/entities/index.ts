/**
 * Entity registry. All entity configs migrated to the generator pattern are
 * listed here. The server walks this array to (a) collect tools at startup
 * and (b) dispatch tool-calls to the first matching entity.
 *
 * Hand-written domains that don't fit the entity-config pattern (reports,
 * legacy expenses naming) continue to live in src/domains/ and are wired
 * separately in src/index.ts.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  entityTools,
  makeEntityDispatcher,
  type EntityDispatcher,
} from "./generator.js";
import type { EntityConfig, EntityExtras } from "./types.js";

import { customerConfig, customerExtras } from "./customer.js";
import { invoiceConfig, invoiceExtras } from "./invoice.js";
import { paymentConfig } from "./payment.js";

interface RegistryEntry {
  config: EntityConfig;
  extras?: EntityExtras;
}

const registry: RegistryEntry[] = [
  { config: customerConfig, extras: customerExtras },
  { config: invoiceConfig, extras: invoiceExtras },
  { config: paymentConfig },
];

export const allEntityTools: Tool[] = registry.flatMap((e) =>
  entityTools(e.config, e.extras)
);

const dispatchers: EntityDispatcher[] = registry.map((e) =>
  makeEntityDispatcher(e.config, e.extras)
);

/**
 * Try each entity dispatcher in turn. Returns the first non-null result, or
 * null if no entity claims this tool name.
 */
export async function dispatchTool(
  toolName: string,
  args: Record<string, unknown>
) {
  for (const dispatch of dispatchers) {
    const result = await dispatch(toolName, args);
    if (result !== null) return result;
  }
  return null;
}

/**
 * Per-entity navigation metadata, exposed for qbo_navigate. Returned in the
 * same order as the registry so domain listings are stable.
 */
export const entityDomains: ReadonlyArray<{
  prefix: string;
  description: string;
  tools: Tool[];
}> = registry.map((e) => ({
  prefix: e.config.toolPrefix,
  description: e.config.description,
  tools: entityTools(e.config, e.extras),
}));
