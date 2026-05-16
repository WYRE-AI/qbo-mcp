/**
 * CompanyInfo entity config — singleton.
 *
 * Only one CompanyInfo record exists per QBO realm. We only expose list
 * (which returns that single record) and get-by-id (the company's CompanyInfo
 * ID, which equals the realm in most cases). Create/update are not supported
 * via this endpoint; company-level changes happen through QBO's UI.
 */

import type { EntityConfig } from "./types.js";

export const companyInfoConfig: EntityConfig = {
  name: "CompanyInfo",
  toolPrefix: "qbo_company_info",
  description: "Company info - get this QBO realm's company profile (read-only)",
  list: {},
  get: { idParam: "companyInfoId" },
};
