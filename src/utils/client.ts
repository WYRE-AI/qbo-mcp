/**
 * QuickBooks Online REST Client
 *
 * Lightweight HTTP client for the QBO API with Bearer token authentication.
 * The client does NOT handle OAuth flows -- in gateway mode the gateway passes
 * a pre-authenticated access token; in env mode the user provides tokens directly.
 *
 * Production base URL: https://quickbooks.api.intuit.com/v3/company/{realmId}/
 * Sandbox base URL:    https://sandbox-quickbooks.api.intuit.com/v3/company/{realmId}/
 * All requests include minorversion=73 query parameter.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const QBO_API_HOSTS = {
  production: "https://quickbooks.api.intuit.com",
  sandbox: "https://sandbox-quickbooks.api.intuit.com",
} as const;
const MINOR_VERSION = "73";
const MAX_PAGE_SIZE = 1000;

export type QboEnvironment = "production" | "sandbox";

/**
 * Configuration for the QBO client
 */
interface QboClientConfig {
  accessToken: string;
  realmId: string;
  environment: QboEnvironment;
}

/**
 * QBO query response envelope
 */
interface QboQueryResponse {
  QueryResponse: Record<string, unknown>;
}

/**
 * Structured error thrown by the REST client when QBO returns non-2xx. The
 * gateway uses `status === 401` to decide whether to refresh the access token
 * and retry the request.
 */
export class QboApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly method: string,
    public readonly path: string,
    public readonly body: string
  ) {
    super(`QBO API error ${method} /${path} (${status}): ${body}`);
    this.name = "QboApiError";
  }

  /**
   * True when QBO rejected the access token. The gateway should refresh and
   * retry; other 4xx codes are caller errors and should surface as-is.
   */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/**
 * QuickBooks Online REST client with Bearer token authentication
 */
class QboClient {
  private config: QboClientConfig;
  private baseUrl: string;

  constructor(config: QboClientConfig) {
    this.config = config;
    this.baseUrl = `${QBO_API_HOSTS[config.environment]}/v3/company/${config.realmId}`;
  }

  /**
   * Make an authenticated request to the QBO API
   */
  private async request(
    method: string,
    path: string,
    params?: Record<string, string>,
    body?: unknown
  ): Promise<unknown> {
    let url = `${this.baseUrl}/${path}`;

    const searchParams = new URLSearchParams({
      minorversion: MINOR_VERSION,
      ...params,
    });
    url += `?${searchParams.toString()}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const options: RequestInit = { method, headers };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const responseBody = await response.text();
      throw new QboApiError(response.status, method, path, responseBody);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  /**
   * GET request
   */
  async get(path: string, params?: Record<string, string>): Promise<unknown> {
    return this.request("GET", path, params);
  }

  /**
   * POST request
   */
  async post(
    path: string,
    body: unknown,
    params?: Record<string, string>
  ): Promise<unknown> {
    return this.request("POST", path, params, body);
  }

  /**
   * POST a multipart/form-data body. Used for the /upload endpoint which
   * needs file_metadata_NN + file_content_NN parts side by side. We don't
   * set Content-Type — fetch derives the boundary from the FormData.
   */
  async postMultipart(path: string, form: FormData): Promise<unknown> {
    const url = `${this.baseUrl}/${path}?minorversion=${MINOR_VERSION}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        Accept: "application/json",
      },
      body: form,
    });
    if (!response.ok) {
      const responseBody = await response.text();
      throw new QboApiError(response.status, "POST", path, responseBody);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  /**
   * Execute a SQL-like query against the QBO API.
   * Uses POST to /query with the SQL string in the request body.
   */
  async query(sql: string): Promise<unknown> {
    return this.request("POST", "query", undefined, sql);
  }

  /**
   * Execute a paginated query, fetching all pages.
   * QBO uses 1-based startPosition and maxResults for pagination.
   */
  async getPaginated(
    baseSql: string,
    maxResults: number = MAX_PAGE_SIZE
  ): Promise<unknown[]> {
    const allItems: unknown[] = [];
    let startPosition = 1;
    let hasMore = true;

    while (hasMore) {
      const paginatedSql = `${baseSql} STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
      const response = (await this.query(paginatedSql)) as QboQueryResponse;

      if (response.QueryResponse) {
        const entities = Object.values(response.QueryResponse).find(
          (v) => Array.isArray(v)
        ) as unknown[] | undefined;

        if (entities && entities.length > 0) {
          allItems.push(...entities);
          if (entities.length < maxResults) {
            hasMore = false;
          } else {
            startPosition += maxResults;
          }
        } else {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }

    return allItems;
  }
}

/**
 * Per-request credential overrides via AsyncLocalStorage.
 * In gateway mode the HTTP handler sets this so that concurrent requests
 * never share or overwrite each other's credentials through process.env.
 */
export interface QboCredentials {
  accessToken: string;
  realmId: string;
  environment: QboEnvironment;
}

export const credentialStore = new AsyncLocalStorage<QboCredentials>();

/**
 * Parse a QBO environment string, defaulting to production. Accepts both
 * "production"/"prod" and "sandbox"/"sbx" for header convenience. Throws on
 * any other non-empty value so a stray `X-Qbo-Environment: staging` header
 * fails loudly rather than silently routing to production.
 */
export function parseEnvironment(value: string | undefined): QboEnvironment {
  if (!value) return "production";
  const normalized = value.toLowerCase();
  if (normalized === "sandbox" || normalized === "sbx") return "sandbox";
  if (normalized === "production" || normalized === "prod") return "production";
  throw new Error(
    `Invalid QBO environment ${JSON.stringify(value)}: expected "production" or "sandbox"`
  );
}

/**
 * Singleton client instance (lazy-loaded, used only in stdio/env mode)
 */
let _client: QboClient | null = null;

/**
 * Get or create the QBO client instance.
 * In gateway mode (AsyncLocalStorage has credentials), creates a fresh client per request.
 * In stdio/env mode, uses a lazy-loaded singleton.
 *
 * @throws Error if credentials are not available
 * @returns The QboClient instance
 */
export function getClient(): QboClient {
  // Prefer per-request credentials from AsyncLocalStorage (gateway mode)
  const override = credentialStore.getStore();
  if (override) {
    return new QboClient({
      accessToken: override.accessToken,
      realmId: override.realmId,
      environment: override.environment,
    });
  }

  // Stdio / env mode: use singleton
  if (!_client) {
    const accessToken = process.env.QBO_ACCESS_TOKEN;
    const realmId = process.env.QBO_REALM_ID;
    const environment = parseEnvironment(process.env.QBO_ENV);

    if (!accessToken || !realmId) {
      throw new Error(
        "QBO_ACCESS_TOKEN and QBO_REALM_ID environment variables are required. " +
          "Provide a pre-authenticated OAuth2 access token and company realm ID. " +
          "Optionally set QBO_ENV=sandbox to target the sandbox API."
      );
    }

    _client = new QboClient({ accessToken, realmId, environment });
  }
  return _client;
}

/**
 * Reset the client instance.
 * Used in tests or when env-mode credentials change.
 */
export function resetClient(): void {
  _client = null;
}
