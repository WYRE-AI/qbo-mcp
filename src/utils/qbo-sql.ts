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
 * Prepare a user term for `LIKE '%term%'`.
 *
 * QBO's query parser does not implement the SQL `ESCAPE` clause — a query
 * that includes one fails with QueryParserError for every term. LIKE's only
 * wildcard is `%` (`_` is literal), so `%` in the term is left as a wildcard.
 *
 * Single quotes are doubled. Backslashes are doubled because QBO also treats
 * `\'` as an escaped apostrophe; a trailing backslash would otherwise escape
 * the closing quote of the literal.
 */
export function escapeQboSearchTerm(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "''");
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
 * QBO rejects MAXRESULTS above 1000. The default upper bound of
 * {@link assertPositiveInt} matches that cap.
 */
export const QBO_MAX_RESULTS = 1000;

/**
 * STARTPOSITION is a 1-based offset. QBO does not cap it at 1000 (that limit
 * is only for MAXRESULTS). A signed 32-bit ceiling keeps a non-integer or
 * absurd value out of the query string.
 */
export const QBO_MAX_START_POSITION = 2_147_483_647;

/**
 * Validate and coerce a positive integer for pagination parameters. The
 * default upper bound is QBO's MAXRESULTS cap of 1000. Pass
 * `max: QBO_MAX_START_POSITION` for STARTPOSITION.
 */
export function assertPositiveInt(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number } = {}
): number {
  const { min = 1, max = QBO_MAX_RESULTS } = opts;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(
      `Invalid ${field}: expected integer in [${min}, ${max}], got ${JSON.stringify(value)}`
    );
  }
  return n;
}

export interface DatedListArgs {
  startPosition?: number;
  maxResults?: number;
  startDate?: string;
  endDate?: string;
}

/**
 * Build `SELECT * FROM {entity} [WHERE ...] STARTPOSITION x MAXRESULTS y`
 * with optional TxnDate range + caller-supplied extra conditions. The
 * `extraConditions` argument is appended verbatim — callers are responsible
 * for escaping any user input it contains.
 */
export function buildDatedListSql(
  entity: string,
  args: DatedListArgs,
  extraConditions: string[] = []
): string {
  const startPosition = assertPositiveInt(args.startPosition ?? 1, "startPosition", {
    max: QBO_MAX_START_POSITION,
  });
  const maxResults = assertPositiveInt(args.maxResults ?? 100, "maxResults");

  const conditions: string[] = [...extraConditions];
  if (args.startDate) {
    conditions.push(`TxnDate >= '${assertDate(args.startDate, "startDate")}'`);
  }
  if (args.endDate) {
    conditions.push(`TxnDate <= '${assertDate(args.endDate, "endDate")}'`);
  }

  let sql = `SELECT * FROM ${entity}`;
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(" AND ")}`;
  }
  sql += ` STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
  return sql;
}

/**
 * `SELECT * FROM {entity} WHERE {field} LIKE '%term%' STARTPOSITION …`.
 *
 * `entity` and `field` must be fixed identifiers from entity config, not user
 * input. The term is escaped with {@link escapeQboSearchTerm}. No `ESCAPE`
 * clause: QBO's parser rejects it.
 */
export function buildLikeSearchSql(
  entity: string,
  field: string,
  rawTerm: string,
  args: Pick<DatedListArgs, "startPosition" | "maxResults"> = {}
): string {
  const term = escapeQboSearchTerm(rawTerm);
  const startPosition = assertPositiveInt(args.startPosition ?? 1, "startPosition", {
    max: QBO_MAX_START_POSITION,
  });
  const maxResults = assertPositiveInt(args.maxResults ?? 100, "maxResults");
  return `SELECT * FROM ${entity} WHERE ${field} LIKE '%${term}%' STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
}
