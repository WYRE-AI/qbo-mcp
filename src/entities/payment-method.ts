/** PaymentMethod entity config — Check, Credit Card, ACH, etc. */

import type { EntityConfig, EntityField } from "./types.js";

const paymentMethodFields: EntityField[] = [
  {
    name: "Name",
    type: "string",
    required: true,
    description: "Payment method name, e.g. \"Visa\" or \"Check\"",
  },
  {
    name: "Type",
    type: "string",
    description: 'Card type for credit-card methods: "CREDIT_CARD" or "NON_CREDIT_CARD"',
  },
  { name: "Active", type: "boolean", description: "Whether the method is active" },
];

export const paymentMethodConfig: EntityConfig = {
  name: "PaymentMethod",
  toolPrefix: "qbo_payment_methods",
  description: "Payment methods - list, get, create, update payment method choices",
  list: {},
  get: { idParam: "paymentMethodId" },
  create: { fields: paymentMethodFields },
  update: { idParam: "paymentMethodId", fields: paymentMethodFields },
  search: { field: "Name" },
};
