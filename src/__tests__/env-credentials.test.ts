import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseEnvFile,
  resolveEnvCredentials,
} from "../utils/env-credentials.js";
import { getClient, resetClient } from "../utils/client.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "qbo-creds-"));
  // Isolate from any ambient QBO_* configuration (dev shells, CI).
  vi.stubEnv("QBO_ACCESS_TOKEN", "");
  vi.stubEnv("QBO_REALM_ID", "");
  vi.stubEnv("QBO_ENV", "");
  vi.stubEnv("QBO_CREDENTIALS_FILE", "");
  resetClient();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  resetClient();
});

describe("parseEnvFile", () => {
  it("parses KEY=VALUE pairs, ignoring comments, blanks, and malformed lines", () => {
    const parsed = parseEnvFile(
      [
        "# rotated by refresh.sh",
        "",
        "QBO_ACCESS_TOKEN=abc123",
        "export QBO_REALM_ID=9130350000000000",
        'QBO_ENV="sandbox"',
        "NOISE_WITHOUT_EQUALS",
      ].join("\n")
    );
    expect(parsed).toEqual({
      QBO_ACCESS_TOKEN: "abc123",
      QBO_REALM_ID: "9130350000000000",
      QBO_ENV: "sandbox",
    });
  });

  it("splits on the first = only, so token values may contain =", () => {
    expect(parseEnvFile("QBO_ACCESS_TOKEN=eyJhbGci==")).toEqual({
      QBO_ACCESS_TOKEN: "eyJhbGci==",
    });
  });

  it("strips matching single quotes", () => {
    expect(parseEnvFile("QBO_ACCESS_TOKEN='tok'")).toEqual({
      QBO_ACCESS_TOKEN: "tok",
    });
  });
});

describe("resolveEnvCredentials", () => {
  it("uses process.env when QBO_CREDENTIALS_FILE is unset", () => {
    vi.stubEnv("QBO_ACCESS_TOKEN", "env-token");
    vi.stubEnv("QBO_REALM_ID", "env-realm");
    vi.stubEnv("QBO_ENV", "sandbox");
    expect(resolveEnvCredentials()).toEqual({
      accessToken: "env-token",
      realmId: "env-realm",
      env: "sandbox",
    });
  });

  it("prefers file values over process.env, falling back per key", () => {
    const file = join(dir, "qbo.env");
    writeFileSync(file, "QBO_ACCESS_TOKEN=file-token\n");
    vi.stubEnv("QBO_CREDENTIALS_FILE", file);
    vi.stubEnv("QBO_ACCESS_TOKEN", "env-token");
    vi.stubEnv("QBO_REALM_ID", "env-realm");
    expect(resolveEnvCredentials()).toEqual({
      accessToken: "file-token",
      realmId: "env-realm",
      env: undefined,
    });
  });

  it("picks up a rotated token on the next call, with no reset or restart", () => {
    const file = join(dir, "qbo.env");
    writeFileSync(file, "QBO_ACCESS_TOKEN=old-token\nQBO_REALM_ID=1\n");
    vi.stubEnv("QBO_CREDENTIALS_FILE", file);
    expect(resolveEnvCredentials().accessToken).toBe("old-token");

    writeFileSync(file, "QBO_ACCESS_TOKEN=new-token\nQBO_REALM_ID=1\n");
    expect(resolveEnvCredentials().accessToken).toBe("new-token");
  });

  it("fails loudly when QBO_CREDENTIALS_FILE points at an unreadable path", () => {
    // Silent fallback to a stale process.env token would recreate the exact
    // failure mode this feature exists to fix (issue #63).
    vi.stubEnv("QBO_CREDENTIALS_FILE", join(dir, "does-not-exist.env"));
    expect(() => resolveEnvCredentials()).toThrow(/QBO_CREDENTIALS_FILE/);
  });
});

describe("getClient with QBO_CREDENTIALS_FILE", () => {
  it("reuses the cached client while credentials are unchanged", () => {
    const file = join(dir, "qbo.env");
    writeFileSync(file, "QBO_ACCESS_TOKEN=tok-a\nQBO_REALM_ID=1\n");
    vi.stubEnv("QBO_CREDENTIALS_FILE", file);
    expect(getClient()).toBe(getClient());
  });

  it("rebuilds the client with the rotated token after the file changes", () => {
    const file = join(dir, "qbo.env");
    writeFileSync(file, "QBO_ACCESS_TOKEN=tok-a\nQBO_REALM_ID=1\n");
    vi.stubEnv("QBO_CREDENTIALS_FILE", file);
    const before = getClient();

    writeFileSync(file, "QBO_ACCESS_TOKEN=tok-b\nQBO_REALM_ID=1\n");
    const after = getClient();

    expect(after).not.toBe(before);
    // TS `private` is compile-time only; reach in to prove the rotated token
    // is what outgoing requests will actually use.
    const config = (after as unknown as { config: { accessToken: string } })
      .config;
    expect(config.accessToken).toBe("tok-b");
  });

  it("still throws a clear error when no credentials are available anywhere", () => {
    expect(() => getClient()).toThrow(/QBO_ACCESS_TOKEN/);
  });
});
