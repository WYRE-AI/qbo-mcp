/**
 * Safe-construction helpers for QBO query strings.
 *
 * QBO's /query endpoint accepts a SQL-like dialect but has no prepared-statement
 * support. Every string that flows from a tool argument into a WHERE clause
 * must be escaped, and every date or integer must be shape-validated, or a
 * caller can break out of the surrounding single quotes and inject arbitrary
 * query fragments.
 */

/**
 * Escape a string for safe inclusion inside single-quoted QBO query literals.
 * QBO follows standard SQL: a single quote is doubled.
 */
export function escapeQboString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Validate that a string matches QBO's expected date format (YYYY-MM-DD).
 * Throws on invalid input — these strings flow into query bodies, so silent
 * coercion would defeat the purpose.
 */
export function assertDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(
      `Invalid ${field}: expected YYYY-MM-DD format, got ${JSON.stringify(value)}`
    );
  }
  return value;
}

/**
 * Validate and coerce a positive integer for pagination parameters. QBO caps
 * MAXRESULTS at 1000 and rejects zero/negative values.
 */
export function assertPositiveInt(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number } = {}
): number {
  const { min = 1, max = 1000 } = opts;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(
      `Invalid ${field}: expected integer in [${min}, ${max}], got ${JSON.stringify(value)}`
    );
  }
  return n;
}
