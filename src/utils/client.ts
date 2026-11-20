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

import { resolveEnvCredentials } from "./env-credentials.js";

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

/** Longest fault message echoed back to callers. */
const MAX_FAULT_MESSAGE_LENGTH = 300;

/**
 * The only parts of a QBO fault we surface: a code and a short message.
 * The upstream body (including `Detail`, which can echo entity values) is
 * never kept, returned, or logged.
 */
interface QboFault {
  code?: string;
  message?: string;
}

/**
 * Extract the first fault's code and message from a QBO error body. Intuit
 * capitalises these keys inconsistently (`Fault.Error[].Message` on API
 * errors, `fault.error[].message` on auth errors), so both are accepted.
 * Anything unparseable yields an empty fault.
 */
export function parseQboFault(responseBody: string): QboFault {
  try {
    const parsed = JSON.parse(responseBody) as Record<string, unknown>;
    const fault = (parsed.Fault ?? parsed.fault) as
      | Record<string, unknown>
      | undefined;
    const errors = (fault?.Error ?? fault?.error) as
      | Record<string, unknown>[]
      | undefined;
    const first = errors?.[0];
    if (!first) return {};
    const code = first.code ?? first.Code;
    const message = first.Message ?? first.message;
    return {
      code:
        typeof code === "string" || typeof code === "number"
          ? String(code)
          : undefined,
      message:
        typeof message === "string"
          ? message.slice(0, MAX_FAULT_MESSAGE_LENGTH)
          : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Structured error thrown by the REST client when QBO returns non-2xx. The
 * gateway uses `status === 401` to decide whether to refresh the access token
 * and retry the request. Carries Intuit's `intuit_tid` (quote it to Intuit
 * support) plus the fault code and message; never the raw upstream body.
 */
export class QboApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly method: string,
    public readonly path: string,
    public readonly intuitTid: string | undefined,
    public readonly fault: QboFault = {}
  ) {
    super(`QBO API error ${method} /${path} (${status})${summarize(intuitTid, fault, ": ")}`);
    this.name = "QboApiError";
  }

  /**
   * True when QBO rejected the access token. The gateway should refresh and
   * retry; other 4xx codes are caller errors and should surface as-is.
   */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** Fault code, message and intuit_tid only, safe to return to MCP callers. */
  get summary(): string {
    return summarize(this.intuitTid, this.fault, "");
  }
}

function summarize(
  intuitTid: string | undefined,
  fault: QboFault,
  prefix: string
): string {
  const parts = [
    fault.code && `code ${fault.code}`,
    fault.message,
    intuitTid && `intuit_tid: ${intuitTid}`,
  ].filter(Boolean);
  return parts.length > 0 ? prefix + parts.join("; ") : "";
}

/**
 * Read Intuit's `intuit_tid` response header, log it at debug level (never the
 * body), and turn non-2xx responses into a QboApiError.
 */
async function handleResponse(
  response: Response,
  method: string,
  path: string
): Promise<unknown> {
  const intuitTid = response.headers.get("intuit_tid") ?? undefined;
  if (process.env.LOG_LEVEL === "debug") {
    console.error(
      `QBO ${method} /${path} -> ${response.status} intuit_tid=${intuitTid ?? "none"}`
    );
  }

  if (!response.ok) {
    throw new QboApiError(
      response.status,
      method,
      path,
      intuitTid,
      parseQboFault(await response.text())
    );
  }

  // Handle 204 No Content
  if (response.status === 204) return null;
  return response.json();
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

    // QBO's /query endpoint expects the raw SQL string with
    // Content-Type: application/text — it rejects application/json with
    // "Unsupported Operation ... expects application/text". Every other
    // endpoint takes a JSON entity body. So: a string body is sent
    // verbatim as application/text; an object body is JSON-encoded.
    const isTextBody = typeof body === "string";
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.accessToken}`,
      "Content-Type": isTextBody ? "application/text" : "application/json",
      Accept: "application/json",
    };

    const options: RequestInit = { method, headers };
    if (body !== undefined) {
      options.body = isTextBody ? (body as string) : JSON.stringify(body);
    }

    return handleResponse(await fetch(url, options), method, path);
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
    return handleResponse(response, "POST", path);
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
 * Cached client for stdio/env mode, keyed by the credentials it was built
 * with so a rotated QBO_CREDENTIALS_FILE transparently produces a new client.
 */
let _client: QboClient | null = null;
let _clientKey: string | null = null;

/**
 * Get or create the QBO client instance.
 * In gateway mode (AsyncLocalStorage has credentials), creates a fresh client per request.
 * In stdio/env mode, credentials are re-resolved on every call (so a rotated
 * QBO_CREDENTIALS_FILE takes effect immediately — issue #63) and the client is
 * rebuilt only when they actually changed.
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

  // Stdio / env mode
  const resolved = resolveEnvCredentials();
  const { accessToken, realmId } = resolved;
  const environment = parseEnvironment(resolved.env);

  if (!accessToken || !realmId) {
    throw new Error(
      "QBO_ACCESS_TOKEN and QBO_REALM_ID are required: set them as environment " +
        "variables, or in the dotenv-format file named by QBO_CREDENTIALS_FILE. " +
        "Provide a pre-authenticated OAuth2 access token and company realm ID. " +
        "Optionally set QBO_ENV=sandbox to target the sandbox API."
    );
  }

  const key = `${accessToken} ${realmId} ${environment}`;
  if (!_client || _clientKey !== key) {
    _client = new QboClient({ accessToken, realmId, environment });
    _clientKey = key;
  }
  return _client;
}

/**
 * Reset the client instance.
 * Used in tests or when env-mode credentials change.
 */
export function resetClient(): void {
  _client = null;
  _clientKey = null;
}
