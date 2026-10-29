/**
 * Validation for QuickBooks ids (entity Ids, SyncTokens, realm ids).
 *
 * QBO ids are numeric strings. Anything else (path separators, dots,
 * percent-escapes, whitespace) could redirect a request to a different
 * endpoint once interpolated into a URL path, so reject it before any
 * request is made.
 */

export const QBO_NUMERIC_ID_PATTERN = /^\d+$/;

/**
 * True when value is a string matching pattern. Custom patterns must be
 * anchored (^...$); an unanchored pattern would let path separators through.
 */
export function isQboId(
  value: unknown,
  pattern: RegExp = QBO_NUMERIC_ID_PATTERN
): value is string {
  return typeof value === "string" && pattern.test(value);
}

export function assertQboId(
  value: unknown,
  field: string,
  pattern: RegExp = QBO_NUMERIC_ID_PATTERN
): string {
  if (!isQboId(value, pattern)) {
    throw new Error(
      pattern === QBO_NUMERIC_ID_PATTERN
        ? `Invalid ${field}: expected a numeric QuickBooks id string`
        : `Invalid ${field}: expected a QuickBooks id string`
    );
  }
  return value;
}
