/**
 * Env-mode credential resolution, with optional file-based rotation.
 *
 * In env mode credentials normally come from process.env — which in Docker is
 * frozen at container *creation*: `env_file` is only read then, so rotating a
 * token in `.env` and running `docker restart` never reaches the process
 * (issue #63). To make rotation effective without a container recreate,
 * QBO_CREDENTIALS_FILE may name a dotenv-format file that is re-read on every
 * request; its values take precedence over process.env. Rotating tokens then
 * means rewriting that (bind-mounted) file — no restart at all.
 *
 * This module is Node-only by nature (node:fs). The Cloudflare Worker
 * entrypoint never reaches it: worker env mode injects credentials through
 * the AsyncLocalStorage credentialStore instead.
 */

import { readFileSync } from "node:fs";

/**
 * Raw credential values before validation. `env` is the unparsed QBO_ENV
 * string — callers run it through parseEnvironment().
 */
export interface ResolvedEnvCredentials {
  accessToken?: string;
  realmId?: string;
  env?: string;
}

/**
 * Minimal dotenv parser: KEY=VALUE per line, `#` comments and blank lines
 * ignored, optional `export ` prefix, optional matching single/double quotes
 * around the value. Split is on the first `=` so values may contain `=`.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

/**
 * Resolve env-mode credentials: QBO_CREDENTIALS_FILE values first (re-read
 * from disk on every call), process.env as the per-key fallback. Empty
 * strings count as unset.
 *
 * @throws when QBO_CREDENTIALS_FILE is set but unreadable — falling back
 *         silently to a possibly-stale process.env token would recreate the
 *         rotation-never-applies bug this exists to fix.
 */
export function resolveEnvCredentials(): ResolvedEnvCredentials {
  const filePath = process.env.QBO_CREDENTIALS_FILE;
  let fileVars: Record<string, string> = {};
  if (filePath) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch (err) {
      throw new Error(
        `QBO_CREDENTIALS_FILE is set but could not be read (${filePath}): ` +
          (err instanceof Error ? err.message : String(err))
      );
    }
    fileVars = parseEnvFile(content);
  }

  const pick = (key: string): string | undefined =>
    fileVars[key] || process.env[key] || undefined;

  return {
    accessToken: pick("QBO_ACCESS_TOKEN"),
    realmId: pick("QBO_REALM_ID"),
    env: pick("QBO_ENV"),
  };
}
