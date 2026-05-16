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
import { purchaseConfig } from "./purchase.js";
import { purchaseOrderConfig } from "./purchase-order.js";
import { estimateConfig } from "./estimate.js";
import { salesReceiptConfig } from "./sales-receipt.js";
import { creditMemoConfig } from "./credit-memo.js";
import { refundReceiptConfig } from "./refund-receipt.js";
import { depositConfig } from "./deposit.js";
import { transferConfig } from "./transfer.js";
import { timeActivityConfig } from "./time-activity.js";
import { classConfig } from "./class.js";
import { departmentConfig } from "./department.js";
import { termConfig } from "./term.js";
import { paymentMethodConfig } from "./payment-method.js";
import { taxCodeConfig } from "./tax-code.js";
import { taxRateConfig } from "./tax-rate.js";
import { employeeConfig } from "./employee.js";
import { companyInfoConfig } from "./company-info.js";
import { attachableConfig } from "./attachable.js";

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
  makeEntry(purchaseConfig),
  makeEntry(purchaseOrderConfig),
  makeEntry(estimateConfig),
  makeEntry(salesReceiptConfig),
  makeEntry(creditMemoConfig),
  makeEntry(refundReceiptConfig),
  makeEntry(depositConfig),
  makeEntry(transferConfig),
  makeEntry(timeActivityConfig),
  makeEntry(classConfig),
  makeEntry(departmentConfig),
  makeEntry(termConfig),
  makeEntry(paymentMethodConfig),
  makeEntry(taxCodeConfig),
  makeEntry(taxRateConfig),
  makeEntry(employeeConfig),
  makeEntry(companyInfoConfig),
  makeEntry(attachableConfig),
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
