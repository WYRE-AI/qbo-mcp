/** Department entity config — locations / business divisions. */

import type { EntityConfig, EntityField } from "./types.js";

const departmentFields: EntityField[] = [
  {
    name: "Name",
    type: "string",
    required: true,
    description: "Department name (required, must be unique within parent)",
  },
  {
    name: "ParentRef",
    type: "object",
    description: "Parent department for sub-departments",
  },
  { name: "Active", type: "boolean", description: "Whether the department is active" },
];

export const departmentConfig: EntityConfig = {
  name: "Department",
  toolPrefix: "qbo_departments",
  description: "Departments - list, get, create, update business locations/divisions",
  list: {},
  get: { idParam: "departmentId" },
  create: { fields: departmentFields },
  update: { idParam: "departmentId", fields: departmentFields },
  search: { field: "Name" },
};
