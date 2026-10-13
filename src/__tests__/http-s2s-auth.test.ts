/**
 * HTTP transport fail-closed auth (CWE-306).
 *
 * Startup requires a real CONDUIT_S2S_SECRET unless MCP_ALLOW_INSECURE_DEV=1.
 * Known placeholders are rejected even with that flag. The flag forces the
 * listener onto 127.0.0.1. A configured secret honors MCP_HTTP_HOST.
 * AUTH_MODE=gateway rejects /mcp requests that omit X-Qbo-Access-Token or
 * X-Qbo-Realm-Id and must not fall back to QBO_* in process.env.
 */

import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { credentialStore } from "../utils/client.js";
import { startHttpTransport } from "../index.js";

const S2S_SECRET = "s2s-do-not-log-7f3a";
const ENV_ACCESS_TOKEN = "env-token-must-not-be-used";
const ENV_REALM_ID = "env-realm-must-not-be-used";
const HEADER_ACCESS_TOKEN = "header-token-do-not-log";
const HEADER_REALM_ID = "9341455555555555";

const ENV_KEYS = [
  "CONDUIT_S2S_SECRET",
  "MCP_ALLOW_INSECURE_DEV",
  "MCP_HTTP_PORT",
  "MCP_HTTP_HOST",
  "AUTH_MODE",
  "QBO_ACCESS_TOKEN",
  "QBO_REALM_ID",
  "QBO_ENV",
  "QBO_CREDENTIALS_FILE",
  "LOG_LEVEL",
  "MCP_TRANSPORT",
] as const;

const savedEnv = new Map<string, string | undefined>();
const servers: Server[] = [];

function mintS2sHeader(secret: string, unixSeconds = Math.floor(Date.now() / 1000)): string {
  const message = `t=${unixSeconds}`;
  const hex = createHmac("sha256", secret).update(message).digest("hex");
  return `${message},v1=${hex}`;
}

function captureStderr(): { text: () => string; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  });
  return {
    text: () => lines.join("\n"),
    restore: () => spy.mockRestore(),
  };
}

function exitSpy() {
  return vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${String(code)}`);
  }) as typeof process.exit);
}

interface HttpResult {
  status: number;
  body: string;
}

function sendHttp(options: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<HttpResult> {
  return fetch(`http://127.0.0.1:${options.port}${options.path}`, {
    method: options.method,
    headers: options.headers,
    body: options.body,
  }).then(async (res) => ({ status: res.status, body: await res.text() }));
}

async function listen(): Promise<{ port: number; address: string; close: () => Promise<void> }> {
  const server = await startHttpTransport();
  servers.push(server);
  const bound = server.address() as AddressInfo | string | null;
  if (!bound || typeof bound === "string") {
    throw new Error("HTTP server did not bind a TCP port");
  }
  return {
    port: bound.port,
    address: bound.address,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function mcpHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...extra,
  };
}

const toolsList = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
  params: {},
});

const statusCall = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "qbo_status", arguments: {} },
});

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  process.env.MCP_HTTP_PORT = "0";
  process.env.MCP_HTTP_HOST = "127.0.0.1";
  delete process.env.CONDUIT_S2S_SECRET;
  delete process.env.MCP_ALLOW_INSECURE_DEV;
  delete process.env.AUTH_MODE;
  delete process.env.QBO_ACCESS_TOKEN;
  delete process.env.QBO_REALM_ID;
  delete process.env.QBO_ENV;
  delete process.env.QBO_CREDENTIALS_FILE;
});

afterEach(async () => {
  vi.restoreAllMocks();
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server?.listening) continue;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

describe("HTTP startup", () => {
  it("refuses to start when CONDUIT_S2S_SECRET is empty", async () => {
    const logs = captureStderr();
    const exit = exitSpy();
    try {
      await expect(startHttpTransport()).rejects.toThrow("process.exit:1");
      expect(exit).toHaveBeenCalledWith(1);
      const text = logs.text();
      expect(text).toContain("Refusing to start HTTP transport");
      expect(text).toContain("CONDUIT_S2S_SECRET is empty");
      expect(text).toContain("MCP_ALLOW_INSECURE_DEV=1");
      expect(text).not.toContain(S2S_SECRET);
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it("still refuses when MCP_ALLOW_INSECURE_DEV is not exactly 1", async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = "true";
    const logs = captureStderr();
    const exit = exitSpy();
    try {
      await expect(startHttpTransport()).rejects.toThrow("process.exit:1");
      expect(logs.text()).toContain("Refusing to start HTTP transport");
      expect(logs.text()).not.toContain(S2S_SECRET);
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it.each(["changeme", "replace-with-a-real-secret", "  Your-S2S-Secret  "])(
    "refuses known placeholder %j even when MCP_ALLOW_INSECURE_DEV=1",
    async (placeholder) => {
      process.env.CONDUIT_S2S_SECRET = placeholder;
      process.env.MCP_ALLOW_INSECURE_DEV = "1";
      process.env.MCP_HTTP_HOST = "0.0.0.0";
      const logs = captureStderr();
      const exit = exitSpy();
      try {
        await expect(startHttpTransport()).rejects.toThrow("process.exit:1");
        expect(exit).toHaveBeenCalledWith(1);
        const text = logs.text();
        expect(text).toContain("known placeholder");
        expect(text).toContain("openssl rand -hex 32");
        expect(text).not.toContain(placeholder.trim());
        expect(text).not.toContain(S2S_SECRET);
      } finally {
        exit.mockRestore();
        logs.restore();
      }
    },
  );

  it("allows startup with a warning when MCP_ALLOW_INSECURE_DEV=1 and binds 127.0.0.1", async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = "1";
    delete process.env.MCP_HTTP_HOST;
    const logs = captureStderr();
    try {
      const server = await listen();
      expect(server.address).toBe("127.0.0.1");
      const text = logs.text();
      expect(text).toContain("SECURITY WARNING");
      expect(text).toContain("CONDUIT_S2S_SECRET");
      expect(text).toContain("MCP_ALLOW_INSECURE_DEV");
      expect(text).toContain("127.0.0.1");
      expect(text).not.toContain(S2S_SECRET);
    } finally {
      logs.restore();
    }
  });

  it.each(["0.0.0.0", "10.1.2.3"])(
    "forces 127.0.0.1 when the dev bypass is set and MCP_HTTP_HOST is %s",
    async (host) => {
      process.env.MCP_ALLOW_INSECURE_DEV = "1";
      process.env.MCP_HTTP_HOST = host;
      const logs = captureStderr();
      try {
        const server = await listen();
        expect(server.address).toBe("127.0.0.1");
        const text = logs.text();
        expect(text).toContain(`MCP_HTTP_HOST=${host} is not a loopback address`);
        expect(text).toContain("forces the listener to 127.0.0.1 only");
        expect(text).not.toContain(S2S_SECRET);
      } finally {
        logs.restore();
      }
    },
  );

  it("forces 127.0.0.1 when the dev bypass host is localhost", async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = "1";
    process.env.MCP_HTTP_HOST = "localhost";
    const logs = captureStderr();
    try {
      const server = await listen();
      expect(server.address).toBe("127.0.0.1");
      expect(logs.text()).toContain("SECURITY WARNING");
      expect(logs.text()).not.toContain("is not a loopback address");
    } finally {
      logs.restore();
    }
  });

  it("honors a non-loopback MCP_HTTP_HOST when CONDUIT_S2S_SECRET is set", async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.MCP_HTTP_HOST = "0.0.0.0";
    const logs = captureStderr();
    try {
      const server = await listen();
      expect(server.address).toBe("0.0.0.0");
      expect(logs.text()).not.toContain("is not a loopback address");
      expect(logs.text()).not.toContain(S2S_SECRET);
    } finally {
      logs.restore();
    }
  });

  it("binds 127.0.0.1 when MCP_HTTP_HOST is unset and a secret is set", async () => {
    delete process.env.MCP_HTTP_HOST;
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    const server = await listen();
    expect(server.address).toBe("127.0.0.1");
  });
});

describe("HTTP /mcp authentication", () => {
  beforeEach(() => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.AUTH_MODE = "gateway";
    process.env.QBO_ACCESS_TOKEN = ENV_ACCESS_TOKEN;
    process.env.QBO_REALM_ID = ENV_REALM_ID;
    process.env.QBO_ENV = "production";
  });

  it("returns 401 when the S2S header is missing or invalid and does not log the secret", async () => {
    const logs = captureStderr();
    const runSpy = vi.spyOn(credentialStore, "run");
    const server = await listen();
    try {
      const missing = await sendHttp({
        port: server.port,
        method: "POST",
        path: "/mcp",
        headers: mcpHeaders({
          "x-qbo-access-token": HEADER_ACCESS_TOKEN,
          "x-qbo-realm-id": HEADER_REALM_ID,
        }),
        body: toolsList,
      });
      const invalid = await sendHttp({
        port: server.port,
        method: "POST",
        path: "/mcp",
        headers: mcpHeaders({
          "x-gateway-s2s": mintS2sHeader("wrong-secret"),
          "x-qbo-access-token": HEADER_ACCESS_TOKEN,
          "x-qbo-realm-id": HEADER_REALM_ID,
        }),
        body: toolsList,
      });

      expect(missing.status).toBe(401);
      expect(invalid.status).toBe(401);
      expect(missing.body).toContain("X-Gateway-S2S");
      expect(invalid.body).toContain("X-Gateway-S2S");
      expect(missing.body).not.toContain(S2S_SECRET);
      expect(invalid.body).not.toContain(S2S_SECRET);
      expect(missing.body).not.toContain(ENV_ACCESS_TOKEN);
      expect(missing.body).not.toContain(HEADER_ACCESS_TOKEN);
      expect(logs.text()).not.toContain(S2S_SECRET);
      expect(logs.text()).not.toContain(ENV_ACCESS_TOKEN);
      expect(logs.text()).not.toContain(HEADER_ACCESS_TOKEN);
      expect(runSpy).not.toHaveBeenCalled();
    } finally {
      logs.restore();
    }
  });

  it("returns 401 in gateway mode without credential headers and does not use env credentials", async () => {
    const runSpy = vi.spyOn(credentialStore, "run");
    const server = await listen();
    const response = await sendHttp({
      port: server.port,
      method: "POST",
      path: "/mcp",
      headers: mcpHeaders({ "x-gateway-s2s": mintS2sHeader(S2S_SECRET) }),
      body: statusCall,
    });
    const blank = await sendHttp({
      port: server.port,
      method: "POST",
      path: "/mcp",
      headers: mcpHeaders({
        "x-gateway-s2s": mintS2sHeader(S2S_SECRET),
        "x-qbo-access-token": "   ",
        "x-qbo-realm-id": HEADER_REALM_ID,
      }),
      body: statusCall,
    });
    const partial = await sendHttp({
      port: server.port,
      method: "POST",
      path: "/mcp",
      headers: mcpHeaders({
        "x-gateway-s2s": mintS2sHeader(S2S_SECRET),
        "x-qbo-access-token": HEADER_ACCESS_TOKEN,
      }),
      body: statusCall,
    });

    expect(response.status).toBe(401);
    expect(blank.status).toBe(401);
    expect(partial.status).toBe(401);
    expect(response.body).toContain("Missing credentials");
    expect(response.body).toContain("X-Qbo-Access-Token");
    expect(response.body).toContain("X-Qbo-Realm-Id");
    expect(response.body).not.toContain(ENV_ACCESS_TOKEN);
    expect(response.body).not.toContain(ENV_REALM_ID);
    expect(response.body).not.toContain(S2S_SECRET);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("accepts a valid S2S header plus credential headers and uses those credentials", async () => {
    const logs = captureStderr();
    const runSpy = vi.spyOn(credentialStore, "run");
    const server = await listen();
    try {
      const response = await sendHttp({
        port: server.port,
        method: "POST",
        path: "/mcp",
        headers: mcpHeaders({
          "x-gateway-s2s": mintS2sHeader(S2S_SECRET),
          "x-qbo-access-token": HEADER_ACCESS_TOKEN,
          "x-qbo-realm-id": HEADER_REALM_ID,
          "x-qbo-environment": "sandbox",
        }),
        body: statusCall,
      });

      expect(response.status).toBe(200);
      const payload = JSON.parse(response.body) as {
        result?: { content?: Array<{ text?: string }> };
      };
      const text = payload.result?.content?.[0]?.text ?? "";
      expect(text).toContain(HEADER_REALM_ID);
      expect(text).toContain("sandbox");
      expect(text).not.toContain(ENV_REALM_ID);
      expect(text).not.toContain(ENV_ACCESS_TOKEN);
      expect(response.body).not.toContain(S2S_SECRET);
      expect(response.body).not.toContain(HEADER_ACCESS_TOKEN);
      expect(logs.text()).not.toContain(S2S_SECRET);
      expect(logs.text()).not.toContain(ENV_ACCESS_TOKEN);
      expect(logs.text()).not.toContain(HEADER_ACCESS_TOKEN);
      expect(runSpy).toHaveBeenCalledWith(
        {
          accessToken: HEADER_ACCESS_TOKEN,
          realmId: HEADER_REALM_ID,
          environment: "sandbox",
        },
        expect.any(Function),
      );
    } finally {
      logs.restore();
    }
  });

  it("does not require vendor credential headers in env mode after S2S auth", async () => {
    process.env.AUTH_MODE = "env";
    const runSpy = vi.spyOn(credentialStore, "run");
    const server = await listen();
    const response = await sendHttp({
      port: server.port,
      method: "POST",
      path: "/mcp",
      headers: mcpHeaders({ "x-gateway-s2s": mintS2sHeader(S2S_SECRET) }),
      body: toolsList,
    });

    expect(response.status).toBe(200);
    const payload = JSON.parse(response.body) as {
      result?: { tools?: Array<{ name?: string }> };
    };
    const names = (payload.result?.tools ?? []).map((tool) => tool.name);
    expect(names).toContain("qbo_navigate");
    expect(response.body).not.toContain(ENV_ACCESS_TOKEN);
    expect(response.body).not.toContain(ENV_REALM_ID);
    expect(response.body).not.toContain(S2S_SECRET);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("serves /health without authentication and without reading credentials", async () => {
    const runSpy = vi.spyOn(credentialStore, "run");
    const server = await listen();
    const response = await sendHttp({
      port: server.port,
      method: "GET",
      path: "/health",
    });
    expect(response.status).toBe(200);
    const body = JSON.parse(response.body) as { status?: string; authMode?: string };
    expect(body.status).toBe("ok");
    expect(body.authMode).toBe("gateway");
    expect(response.body).not.toContain(S2S_SECRET);
    expect(response.body).not.toContain(ENV_ACCESS_TOKEN);
    expect(response.body).not.toContain(ENV_REALM_ID);
    expect(runSpy).not.toHaveBeenCalled();
  });
});
