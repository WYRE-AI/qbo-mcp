/**
 * Customers domain tools for QBO MCP Server
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../utils/client.js";
import { elicitText } from "../utils/elicitation.js";
import { assertPositiveInt, escapeQboString } from "../utils/qbo-sql.js";

/**
 * Customer domain tool definitions
 */
export const customerTools: Tool[] = [
  {
    name: "qbo_customers_list",
    description:
      "List customers in QuickBooks Online with pagination. Returns customer details including name, email, and balance.",
    inputSchema: {
      type: "object",
      properties: {
        startPosition: {
          type: "number",
          description: "Starting position for pagination (1-based, default: 1)",
        },
        maxResults: {
          type: "number",
          description:
            "Maximum number of results to return (default: 100, max: 1000)",
        },
      },
    },
  },
  {
    name: "qbo_customers_get",
    description:
      "Get detailed information about a specific customer by their ID. Returns full customer profile including contact info, billing address, and balance.",
    inputSchema: {
      type: "object",
      properties: {
        customerId: {
          type: "string",
          description: "The unique customer ID",
        },
      },
      required: ["customerId"],
    },
  },
  {
    name: "qbo_customers_create",
    description:
      "Create a new customer in QuickBooks Online. DisplayName is required.",
    inputSchema: {
      type: "object",
      properties: {
        DisplayName: {
          type: "string",
          description: "Display name for the customer (required, must be unique)",
        },
        GivenName: {
          type: "string",
          description: "First name of the customer",
        },
        FamilyName: {
          type: "string",
          description: "Last name of the customer",
        },
        CompanyName: {
          type: "string",
          description: "Company name",
        },
        PrimaryEmailAddr: {
          type: "object",
          description:
            'Primary email address object, e.g. {"Address": "user@example.com"}',
        },
        PrimaryPhone: {
          type: "object",
          description:
            'Primary phone object, e.g. {"FreeFormNumber": "555-1234"}',
        },
        BillAddr: {
          type: "object",
          description:
            'Billing address object with Line1, City, CountrySubDivisionCode, PostalCode',
        },
      },
      required: ["DisplayName"],
    },
  },
  {
    name: "qbo_customers_search",
    description:
      "Search for customers by display name. Uses a LIKE query to find partial matches.",
    inputSchema: {
      type: "object",
      properties: {
        term: {
          type: "string",
          description: "Search term to match against customer DisplayName",
        },
        startPosition: {
          type: "number",
          description: "Starting position for pagination (1-based, default: 1)",
        },
        maxResults: {
          type: "number",
          description:
            "Maximum number of results to return (default: 100, max: 1000)",
        },
      },
      required: ["term"],
    },
  },
];

/**
 * Handle customer domain tool calls
 */
export async function handleCustomerTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const client = getClient();

  switch (name) {
    case "qbo_customers_list": {
      const rawArgs = args as { startPosition?: number; maxResults?: number };
      const startPosition = assertPositiveInt(rawArgs.startPosition ?? 1, "startPosition");
      const maxResults = assertPositiveInt(rawArgs.maxResults ?? 100, "maxResults");

      let searchTerm: string | null = null;
      if (startPosition === 1 && maxResults === 100 && Object.keys(args).length === 0) {
        searchTerm = await elicitText(
          "Would you like to search for a specific customer? Enter a name, or leave blank to list all.",
          "searchTerm",
          "Enter a customer name to search for"
        );
      }

      let sql: string;
      if (searchTerm) {
        sql = `SELECT * FROM Customer WHERE DisplayName LIKE '%${escapeQboString(searchTerm)}%' STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
      } else {
        sql = `SELECT * FROM Customer STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
      }
      const response = await client.query(sql);
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    case "qbo_customers_get": {
      const { customerId } = args as { customerId: string };
      const customer = await client.get(`customer/${customerId}`);
      return {
        content: [{ type: "text", text: JSON.stringify(customer, null, 2) }],
      };
    }

    case "qbo_customers_create": {
      const {
        DisplayName,
        GivenName,
        FamilyName,
        CompanyName,
        PrimaryEmailAddr,
        PrimaryPhone,
        BillAddr,
      } = args as {
        DisplayName: string;
        GivenName?: string;
        FamilyName?: string;
        CompanyName?: string;
        PrimaryEmailAddr?: { Address: string };
        PrimaryPhone?: { FreeFormNumber: string };
        BillAddr?: Record<string, unknown>;
      };

      const body: Record<string, unknown> = { DisplayName };
      if (GivenName) body.GivenName = GivenName;
      if (FamilyName) body.FamilyName = FamilyName;
      if (CompanyName) body.CompanyName = CompanyName;
      if (PrimaryEmailAddr) body.PrimaryEmailAddr = PrimaryEmailAddr;
      if (PrimaryPhone) body.PrimaryPhone = PrimaryPhone;
      if (BillAddr) body.BillAddr = BillAddr;

      const customer = await client.post("customer", body);
      return {
        content: [{ type: "text", text: JSON.stringify(customer, null, 2) }],
      };
    }

    case "qbo_customers_search": {
      const rawArgs = args as {
        term: string;
        startPosition?: number;
        maxResults?: number;
      };
      const startPosition = assertPositiveInt(rawArgs.startPosition ?? 1, "startPosition");
      const maxResults = assertPositiveInt(rawArgs.maxResults ?? 100, "maxResults");
      const term = escapeQboString(rawArgs.term);

      const sql = `SELECT * FROM Customer WHERE DisplayName LIKE '%${term}%' STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
      const response = await client.query(sql);
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown customer tool: ${name}` }],
        isError: true,
      };
  }
}
