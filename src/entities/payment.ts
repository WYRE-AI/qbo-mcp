/** Payment entity config — standard CRUD; generator handles everything. */

import type { EntityConfig } from "./types.js";

export const paymentConfig: EntityConfig = {
  name: "Payment",
  toolPrefix: "qbo_payments",
  description:
    "Payment management - list, get, and create payments linked to invoices",
  list: { dateRange: true },
  get: { idParam: "paymentId" },
  create: {
    fields: [
      {
        name: "CustomerRef",
        type: "object",
        required: true,
        description:
          'Customer reference object, e.g. {"value": "123"} where value is the customer ID',
      },
      {
        name: "TotalAmt",
        type: "number",
        required: true,
        description: "Total payment amount",
      },
      {
        name: "TxnDate",
        type: "string",
        description: "Transaction date (YYYY-MM-DD format)",
      },
      {
        name: "PaymentMethodRef",
        type: "object",
        description: 'Payment method reference object, e.g. {"value": "1"}',
      },
      {
        name: "Line",
        type: "array",
        description:
          "Array of LinkedTxn entries linking this payment to invoices, e.g. [{Amount: 100, LinkedTxn: [{TxnId: '5', TxnType: 'Invoice'}]}]",
        items: { type: "object" },
      },
    ],
  },
};
