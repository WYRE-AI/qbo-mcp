/** Employee entity config — workers paid via payroll or time tracking. */

import type { EntityConfig, EntityField } from "./types.js";

const employeeFields: EntityField[] = [
  {
    name: "DisplayName",
    type: "string",
    required: true,
    description: "Display name (required, must be unique)",
  },
  { name: "GivenName", type: "string", description: "First name" },
  { name: "FamilyName", type: "string", description: "Last name" },
  { name: "MiddleName", type: "string", description: "Middle name" },
  {
    name: "PrimaryEmailAddr",
    type: "object",
    description: 'Email, e.g. {"Address": "employee@example.com"}',
  },
  {
    name: "PrimaryPhone",
    type: "object",
    description: 'Phone, e.g. {"FreeFormNumber": "555-1234"}',
  },
  {
    name: "PrimaryAddr",
    type: "object",
    description: "Home address (Line1, City, CountrySubDivisionCode, PostalCode)",
  },
  {
    name: "EmployeeNumber",
    type: "string",
    description: "Internal employee number",
  },
  { name: "BirthDate", type: "string", description: "Birth date (YYYY-MM-DD)" },
  { name: "HiredDate", type: "string", description: "Hire date (YYYY-MM-DD)" },
  { name: "ReleasedDate", type: "string", description: "Termination date (YYYY-MM-DD)" },
  {
    name: "BillableTime",
    type: "boolean",
    description: "Whether the employee's time is billable to customers",
  },
  { name: "Active", type: "boolean", description: "Whether the employee is active" },
];

export const employeeConfig: EntityConfig = {
  name: "Employee",
  toolPrefix: "qbo_employees",
  description: "Employees - list, get, create, update, and search employees",
  list: {},
  get: { idParam: "employeeId" },
  create: { fields: employeeFields },
  update: { idParam: "employeeId", fields: employeeFields },
  search: { field: "DisplayName" },
};
