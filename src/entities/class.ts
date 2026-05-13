/** Class entity config — used to categorize transactions by line of business or location. */

import type { EntityConfig, EntityField } from "./types.js";

const classFields: EntityField[] = [
  {
    name: "Name",
    type: "string",
    required: true,
    description: "Class name (required, must be unique within parent)",
  },
  {
    name: "ParentRef",
    type: "object",
    description: 'Parent class for sub-classes, e.g. {"value": "3"}',
  },
  { name: "Active", type: "boolean", description: "Whether the class is active" },
];

export const classConfig: EntityConfig = {
  name: "Class",
  toolPrefix: "qbo_classes",
  description: "Classes - list, get, create, update transaction classifications",
  list: {},
  get: { idParam: "classId" },
  create: { fields: classFields },
  update: { idParam: "classId", fields: classFields },
  search: { field: "Name" },
};
