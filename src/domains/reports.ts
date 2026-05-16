/**
 * Reports domain tools for QBO MCP Server
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../utils/client.js";

/** Tool name → QBO report endpoint name for reports sharing the
 * start_date / end_date / accounting_method shape. */
const datedReportEndpoints: Record<string, string> = {
  qbo_reports_cash_flow: "CashFlow",
  qbo_reports_trial_balance: "TrialBalance",
  qbo_reports_general_ledger: "GeneralLedger",
  qbo_reports_vendor_expenses: "VendorExpenses",
};

/**
 * Report domain tool definitions
 */
export const reportTools: Tool[] = [
  {
    name: "qbo_reports_profit_and_loss",
    description:
      "Get a Profit and Loss (Income Statement) report for a given date range. Shows revenue, expenses, and net income.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: {
          type: "string",
          description: "Start date for the report period (YYYY-MM-DD format)",
        },
        end_date: {
          type: "string",
          description: "End date for the report period (YYYY-MM-DD format)",
        },
        accounting_method: {
          type: "string",
          enum: ["Cash", "Accrual"],
          description: "Accounting method (default: Accrual)",
        },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "qbo_reports_balance_sheet",
    description:
      "Get a Balance Sheet report as of a given date range. Shows assets, liabilities, and equity.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: {
          type: "string",
          description: "Start date for the report period (YYYY-MM-DD format)",
        },
        end_date: {
          type: "string",
          description: "End date for the report period (YYYY-MM-DD format)",
        },
        accounting_method: {
          type: "string",
          enum: ["Cash", "Accrual"],
          description: "Accounting method (default: Accrual)",
        },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "qbo_reports_aged_receivables",
    description:
      "Get an Aged Receivables (A/R Aging Summary) report. Shows outstanding customer balances grouped by age.",
    inputSchema: {
      type: "object",
      properties: {
        report_date: {
          type: "string",
          description:
            "Report as-of date (YYYY-MM-DD format, default: today)",
        },
      },
    },
  },
  {
    name: "qbo_reports_aged_payables",
    description:
      "Get an Aged Payables (A/P Aging Summary) report. Shows outstanding vendor balances grouped by age.",
    inputSchema: {
      type: "object",
      properties: {
        report_date: {
          type: "string",
          description:
            "Report as-of date (YYYY-MM-DD format, default: today)",
        },
      },
    },
  },
  {
    name: "qbo_reports_customer_sales",
    description:
      "Get a Customer Sales report for a given date range. Shows sales totals broken down by customer.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: {
          type: "string",
          description: "Start date for the report period (YYYY-MM-DD format)",
        },
        end_date: {
          type: "string",
          description: "End date for the report period (YYYY-MM-DD format)",
        },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "qbo_reports_cash_flow",
    description:
      "Get a Cash Flow Statement for a given date range. Shows cash inflows and outflows from operating, investing, and financing activities.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date (YYYY-MM-DD)" },
        end_date: { type: "string", description: "End date (YYYY-MM-DD)" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "qbo_reports_trial_balance",
    description:
      "Get a Trial Balance report as of a given date. Lists all accounts with their debit/credit balances to verify the books balance.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date (YYYY-MM-DD)" },
        end_date: { type: "string", description: "End date (YYYY-MM-DD)" },
        accounting_method: {
          type: "string",
          enum: ["Cash", "Accrual"],
          description: "Accounting method (default: Accrual)",
        },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "qbo_reports_general_ledger",
    description:
      "Get a General Ledger report for a given date range. Shows every posted transaction grouped by account.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date (YYYY-MM-DD)" },
        end_date: { type: "string", description: "End date (YYYY-MM-DD)" },
        accounting_method: {
          type: "string",
          enum: ["Cash", "Accrual"],
          description: "Accounting method (default: Accrual)",
        },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "qbo_reports_customer_balance",
    description:
      "Get a Customer Balance report as of a given date. Lists the outstanding balance owed by each customer.",
    inputSchema: {
      type: "object",
      properties: {
        report_date: {
          type: "string",
          description: "Report as-of date (YYYY-MM-DD, default: today)",
        },
      },
    },
  },
  {
    name: "qbo_reports_vendor_expenses",
    description:
      "Get a Vendor Expenses report for a given date range. Shows expense totals broken down by vendor.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date (YYYY-MM-DD)" },
        end_date: { type: "string", description: "End date (YYYY-MM-DD)" },
      },
      required: ["start_date", "end_date"],
    },
  },
];

/**
 * Handle report domain tool calls
 */
export async function handleReportTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const client = getClient();

  switch (name) {
    case "qbo_reports_profit_and_loss": {
      const { start_date, end_date, accounting_method } = args as {
        start_date: string;
        end_date: string;
        accounting_method?: string;
      };

      const params: Record<string, string> = {
        start_date,
        end_date,
      };
      if (accounting_method) params.accounting_method = accounting_method;

      const report = await client.get("reports/ProfitAndLoss", params);
      return {
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
      };
    }

    case "qbo_reports_balance_sheet": {
      const { start_date, end_date, accounting_method } = args as {
        start_date: string;
        end_date: string;
        accounting_method?: string;
      };

      const params: Record<string, string> = {
        start_date,
        end_date,
      };
      if (accounting_method) params.accounting_method = accounting_method;

      const report = await client.get("reports/BalanceSheet", params);
      return {
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
      };
    }

    case "qbo_reports_aged_receivables": {
      const { report_date } = args as { report_date?: string };

      const params: Record<string, string> = {};
      if (report_date) params.report_date = report_date;

      const report = await client.get("reports/AgedReceivables", params);
      return {
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
      };
    }

    case "qbo_reports_aged_payables": {
      const { report_date } = args as { report_date?: string };

      const params: Record<string, string> = {};
      if (report_date) params.report_date = report_date;

      const report = await client.get("reports/AgedPayables", params);
      return {
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
      };
    }

    case "qbo_reports_customer_sales": {
      const { start_date, end_date } = args as {
        start_date: string;
        end_date: string;
      };

      const params: Record<string, string> = {
        start_date,
        end_date,
      };

      const report = await client.get("reports/CustomerSales", params);
      return {
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
      };
    }

    case "qbo_reports_cash_flow":
    case "qbo_reports_trial_balance":
    case "qbo_reports_general_ledger":
    case "qbo_reports_vendor_expenses": {
      const { start_date, end_date, accounting_method } = args as {
        start_date: string;
        end_date: string;
        accounting_method?: string;
      };
      const params: Record<string, string> = { start_date, end_date };
      if (accounting_method) params.accounting_method = accounting_method;
      const report = await client.get(`reports/${datedReportEndpoints[name]}`, params);
      return {
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
      };
    }

    case "qbo_reports_customer_balance": {
      const { report_date } = args as { report_date?: string };
      const params: Record<string, string> = {};
      if (report_date) params.report_date = report_date;
      const report = await client.get("reports/CustomerBalance", params);
      return {
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown report tool: ${name}` }],
        isError: true,
      };
  }
}
