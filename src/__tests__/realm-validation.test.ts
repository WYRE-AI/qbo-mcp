import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveGatewayCredentials } from "../mcp-server.js";
import { credentialStore, getClient, resetClient } from "../utils/client.js";
import { assertQboId } from "../utils/qbo-ids.js";

const headers =
  (realm: string | undefined) =>
  (name: string): string | undefined =>
    ({
      "x-qbo-access-token": "secret-token-value",
      "x-qbo-realm-id": realm,
    })[name];

describe("assertQboId", () => {
  it("accepts numeric strings and rejects everything else", () => {
    expect(assertQboId("123", "id")).toBe("123");
    for (const bad of ["", " 1", "1 ", "1a", "../1", 12, null, undefined, {}]) {
      expect(() => assertQboId(bad, "thing")).toThrow(
        "Invalid thing: expected a numeric QuickBooks id string"
      );
    }
  });
});

describe("realm id validation", () => {
  afterEach(() => {
    resetClient();
    vi.unstubAllEnvs();
  });

  it("gateway rejects a path-traversal realm header with 400", () => {
    const result = resolveGatewayCredentials(headers("123/../456"));
    expect(result.status).toBe(400);
    expect(result.creds).toBeUndefined();
    expect(result.error).not.toContain("secret-token-value");
  });

  it("gateway accepts a numeric realm", () => {
    const result = resolveGatewayCredentials(headers("9341455555555555"));
    expect(result.creds?.realmId).toBe("9341455555555555");
  });

  it("client constructor rejects a bad realm without echoing the token", () => {
    const creds = {
      accessToken: "secret-token-value",
      realmId: "1/../2",
      environment: "sandbox" as const,
    };
    let message = "";
    try {
      credentialStore.run(creds, () => getClient());
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/Invalid realmId/);
    expect(message).not.toContain("secret-token-value");
  });

  it("env-mode credentials flow through the same client validation", () => {
    vi.stubEnv("QBO_CREDENTIALS_FILE", "");
    vi.stubEnv("QBO_ACCESS_TOKEN", "secret-token-value");
    vi.stubEnv("QBO_REALM_ID", "env-realm");
    expect(() => getClient()).toThrow(/Invalid realmId/);
  });
});
