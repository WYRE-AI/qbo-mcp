/**
 * Entity registry. Each entry's tools + dispatcher are assembled once at
 * module load. dispatchTool walks dispatchers in registry order; the first
 * one to claim the tool name wins.
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
import { vendorConfig } from "./vendor.js";
import { itemConfig } from "./item.js";
import { accountConfig } from "./account.js";
import { journalEntryConfig } from "./journal-entry.js";
import { billConfig } from "./bill.js";
import { billPaymentConfig } from "./bill-payment.js";
import { vendorCreditConfig } from "./vendor-credit.js";

interface RegistryEntry {
  config: EntityConfig;
  extras?: EntityExtras;
  tools: Tool[];
  dispatch: EntityDispatcher;
}

function makeEntry(config: EntityConfig, extras?: EntityExtras): RegistryEntry {
  return {
    config,
    extras,
    tools: entityTools(config, extras),
    dispatch: makeEntityDispatcher(config, extras),
  };
}

const registry: RegistryEntry[] = [
  makeEntry(customerConfig, customerExtras),
  makeEntry(invoiceConfig, invoiceExtras),
  makeEntry(paymentConfig),
  makeEntry(vendorConfig),
  makeEntry(itemConfig),
  makeEntry(accountConfig),
  makeEntry(journalEntryConfig),
  makeEntry(billConfig),
  makeEntry(billPaymentConfig),
  makeEntry(vendorCreditConfig),
];

export const allEntityTools: Tool[] = registry.flatMap((e) => e.tools);

export async function dispatchTool(
  toolName: string,
  args: Record<string, unknown>
) {
  for (const entry of registry) {
    const result = await entry.dispatch(toolName, args);
    if (result !== null) return result;
  }
  return null;
}

/** Per-entity navigation metadata for qbo_navigate, in registry order. */
export const entityDomains: ReadonlyArray<{
  prefix: string;
  description: string;
  tools: Tool[];
}> = registry.map((e) => ({
  prefix: e.config.toolPrefix,
  description: e.config.description,
  tools: e.tools,
}));
