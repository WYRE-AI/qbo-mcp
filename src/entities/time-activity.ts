/**
 * TimeActivity entity config — billable / payable employee or vendor time.
 *
 * Use either Hours+Minutes for a duration or StartTime+EndTime for an
 * interval. NameOf identifies whether the time is by an Employee or Vendor.
 */

import type { EntityConfig, EntityField } from "./types.js";

const timeActivityFields: EntityField[] = [
  {
    name: "TxnDate",
    type: "string",
    required: true,
    description: "Activity date (YYYY-MM-DD)",
  },
  {
    name: "NameOf",
    type: "string",
    required: true,
    description: 'Whose time this is: "Employee" or "Vendor"',
  },
  {
    name: "EmployeeRef",
    type: "object",
    description: 'Employee reference when NameOf is "Employee", e.g. {"value": "42"}',
  },
  {
    name: "VendorRef",
    type: "object",
    description: 'Vendor reference when NameOf is "Vendor", e.g. {"value": "56"}',
  },
  {
    name: "CustomerRef",
    type: "object",
    description: 'Customer the time is billed to (optional)',
  },
  { name: "Hours", type: "number", description: "Duration hours portion" },
  { name: "Minutes", type: "number", description: "Duration minutes portion" },
  {
    name: "StartTime",
    type: "string",
    description: "Start time (ISO 8601), alternative to Hours+Minutes",
  },
  {
    name: "EndTime",
    type: "string",
    description: "End time (ISO 8601), alternative to Hours+Minutes",
  },
  {
    name: "BillableStatus",
    type: "string",
    description:
      'Billable status: "Billable", "NotBillable", or "HasBeenBilled"',
  },
  { name: "HourlyRate", type: "number", description: "Hourly billing rate" },
  {
    name: "ItemRef",
    type: "object",
    description: 'Service item the time is logged against, e.g. {"value": "7"}',
  },
  {
    name: "Taxable",
    type: "boolean",
    description: "Whether the time is taxable when billed",
  },
  { name: "Description", type: "string", description: "Activity description" },
];

export const timeActivityConfig: EntityConfig = {
  name: "TimeActivity",
  toolPrefix: "qbo_time_activities",
  description:
    "Time activities - list, get, create, update billable employee/vendor time",
  list: { dateRange: true },
  get: { idParam: "timeActivityId" },
  create: { fields: timeActivityFields },
  update: { idParam: "timeActivityId", fields: timeActivityFields },
};
