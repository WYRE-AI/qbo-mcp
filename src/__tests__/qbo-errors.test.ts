/**
 * QBO error handling: intuit_tid capture and error-body redaction.
 *
 * Intuit asks apps to log the `intuit_tid` response header for support, and
 * raw upstream bodies (which can echo customer data in `Detail`) must never be
 * returned to MCP callers or written to logs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../mcp-server.js";
import { credentialStore, getClient, parseQboFault, QboApiError } from "../utils/client.js";

const CREDS = {
  accessToken: "tok-do-not-log",
  realmId: "123",
  environment: "sandbox",
} as const;

const SECRET_DETAIL = "Duplicate Name: Acme Secret Holdings LLC, Id=987";

const validationFault = JSON.stringify({
  Fault: {
    Error: [
      {
        Message: "Duplicate Name Exists Error",
        Detail: SECRET_DETAIL,
        code: "6240",
        element: "",
      },
    ],
    type: "ValidationFault",
  },
  time: "2026-11-20T10:00:00.000-08:00",
});

const authFault = JSON.stringify({
  fault: {
    error: [{ message: "message=AuthenticationFailed; errorCode=003200; statusCode=401", detail: "Token expired: " + SECRET_DETAIL }],
    type: "AUTHENTICATION",
  },
});

function mockFetch(status: number, body: string, headers: Record<string, string> = {}) {
  const fn = vi.fn(async () => new Response(body, { status, headers }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function caught(promise: Promise<unknown>): Promise<QboApiError> {
  try {
    await promise;
  } catch (err) {
    return err as QboApiError;
  }
  throw new Error("expected the request to fail");
}

beforeEach(() => {
  delete process.env.LOG_LEVEL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.LOG_LEVEL;
});

describe("parseQboFault", () => {
  it("reads the capitalised API fault shape", () => {
    expect(parseQboFault(validationFault)).toEqual({
      code: "6240",
      message: "Duplicate Name Exists Error",
    });
  });

  it("reads the lowercase auth fault shape", () => {
    expect(parseQboFault(authFault).message).toMatch(/AuthenticationFailed/);
  });

  it("returns an empty fault for non-JSON bodies", () => {
    expect(parseQboFault("<html>nope</html>")).toEqual({});
  });
});

describe("intuit_tid capture", () => {
  it("puts intuit_tid on QboApiError and drops the upstream body", async () => {
    mockFetch(400, validationFault, { intuit_tid: "1-abc-123" });
    const err = await caught(credentialStore.run(CREDS, () => getClient().get("customer/1")));

    expect(err).toBeInstanceOf(QboApiError);
    expect(err.intuitTid).toBe("1-abc-123");
    expect(err.message).toContain("intuit_tid: 1-abc-123");
    expect(err.message).toContain("code 6240");
    expect(err.message).toContain("Duplicate Name Exists Error");
    expect(err.message).not.toContain(SECRET_DETAIL);
    expect(JSON.stringify(err)).not.toContain(SECRET_DETAIL);
    expect(err).not.toHaveProperty("body");
  });

  it("treats a top-level Fault in an HTTP 200 body as an error", async () => {
    mockFetch(200, validationFault, { intuit_tid: "1-fault-200" });
    const err = await caught(credentialStore.run(CREDS, () => getClient().get("customer/1")));

    expect(err).toBeInstanceOf(QboApiError);
    expect(err.intuitTid).toBe("1-fault-200");
    expect(err.message).toContain("code 6240");
    expect(err.message).not.toContain(SECRET_DETAIL);
  });

  it("captures intuit_tid on multipart upload failures too", async () => {
    mockFetch(500, "boom", { intuit_tid: "1-upload-9" });
    const err = await caught(
      credentialStore.run(CREDS, () => getClient().postMultipart("upload", new FormData())),
    );
    expect(err.intuitTid).toBe("1-upload-9");
    expect(err.message).not.toContain("boom");
  });

  it("logs intuit_tid at debug level without logging the body", async () => {
    process.env.LOG_LEVEL = "debug";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(200, JSON.stringify({ Customer: { Id: "1", DisplayName: "Private Name" } }), {
      intuit_tid: "1-ok-1",
    });
    await credentialStore.run(CREDS, () => getClient().get("customer/1"));

    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toContain("intuit_tid=1-ok-1");
    expect(logged).not.toContain("Private Name");
    expect(logged).not.toContain(CREDS.accessToken);
  });

  it("does not log per-request lines unless LOG_LEVEL=debug", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(200, "{}", { intuit_tid: "1-quiet" });
    await credentialStore.run(CREDS, () => getClient().get("customer/1"));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("tool error responses", () => {
  async function callTool(): Promise<string> {
    const server = createMcpServer();
    const client = new Client({ name: "vitest", version: "0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await credentialStore.run(CREDS, () =>
        client.callTool({ name: "qbo_customers_get", arguments: { id: "1" } }),
      );
      return (result.content as { text: string }[]).map((c) => c.text).join("\n");
    } finally {
      await client.close();
      await server.close();
    }
  }

  it("returns fault code, message and intuit_tid for API errors, not the body", async () => {
    mockFetch(400, validationFault, { intuit_tid: "1-tool-1" });
    const text = await callTool();
    expect(text).toContain("6240");
    expect(text).toContain("Duplicate Name Exists Error");
    expect(text).toContain("1-tool-1");
    expect(text).not.toContain(SECRET_DETAIL);
  });

  it("keeps the QBO_UNAUTHORIZED tag on 401 without echoing the body", async () => {
    mockFetch(401, authFault, { intuit_tid: "1-401-1" });
    const text = await callTool();
    expect(text).toContain("QBO_UNAUTHORIZED");
    expect(text).toContain("1-401-1");
    expect(text).not.toContain(SECRET_DETAIL);
  });
});
