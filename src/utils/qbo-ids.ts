/**
 * Validation for QuickBooks ids (entity Ids, SyncTokens, realm ids).
 *
 * QBO ids are numeric strings. Anything else (path separators, dots,
 * percent-escapes, whitespace) could redirect a request to a different
 * endpoint once interpolated into a URL path, so reject it before any
 * request is made.
 */

const QBO_ID_PATTERN = /^\d+$/;

export function isQboId(value: unknown): value is string {
  return typeof value === "string" && QBO_ID_PATTERN.test(value);
}

export function assertQboId(value: unknown, field: string): string {
  if (!isQboId(value)) {
    throw new Error(`Invalid ${field}: expected a numeric QuickBooks id string`);
  }
  return value;
}
