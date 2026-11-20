/**
 * Tests for the Cloudflare Workers entrypoint.
 *
 * Drives the exported `fetch` handler directly with Web Standard Request objects
 * (available natively in Node 18+), exercising the same WebStandardStreamableHTTP
 * transport the Worker uses in production.
 */

import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import worker, { type Env } from "../worker.js";

const S2S_SECRET = "worker-s2s-do-not-log-4c1e";

function mintS2sHeader(secret: string, unixSeconds = Math.floor(Date.now() / 1000)): string {
  const message = `t=${unixSeconds}`;
  return `${message},v1=${createHmac("sha256", secret).update(message).digest("hex")}`;
}

const MCP_HEADERS = {
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
  "X-Gateway-S2S": mintS2sHeader(S2S_SECRET),
};

async function mcp(body: unknown, env: Env = {}): Promise<Response> {
  return worker.fetch(
    new Request("http://worker.local/mcp", {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(body),
    }),
    { CONDUIT_S2S_SECRET: S2S_SECRET, ...env },
  );
}

describe("Cloudflare Worker entrypoint", () => {
  it("serves a shallow health probe", async () => {
    const res = await worker.fetch(new Request("http://worker.local/health"), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("does not send permissive CORS headers", async () => {
    const res = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  describe("S2S auth on /mcp", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const call = (headers: Record<string, string>, env: Env) =>
      worker.fetch(
        new Request("http://worker.local/mcp", {
          method: "POST",
          headers: { ...MCP_HEADERS, ...headers },
          body,
        }),
        env,
      );

    it("rejects a request with no S2S header", async () => {
      const res = await call({ "X-Gateway-S2S": "" }, { CONDUIT_S2S_SECRET: S2S_SECRET });
      expect(res.status).toBe(401);
    });

    it("rejects a header signed with the wrong secret", async () => {
      const res = await call(
        { "X-Gateway-S2S": mintS2sHeader("some-other-secret") },
        { CONDUIT_S2S_SECRET: S2S_SECRET },
      );
      expect(res.status).toBe(401);
    });

    it("rejects a stale header outside the skew window", async () => {
      const stale = mintS2sHeader(S2S_SECRET, Math.floor(Date.now() / 1000) - 3600);
      const res = await call({ "X-Gateway-S2S": stale }, { CONDUIT_S2S_SECRET: S2S_SECRET });
      expect(res.status).toBe(401);
    });

    it("fails closed when CONDUIT_S2S_SECRET is not configured", async () => {
      const res = await call({}, {});
      expect(res.status).toBe(503);
    });

    it("keeps /health unauthenticated", async () => {
      const res = await worker.fetch(new Request("http://worker.local/health"), {});
      expect(res.status).toBe(200);
    });
  });

  it("404s unknown paths", async () => {
    const res = await worker.fetch(new Request("http://worker.local/nope"), {});
    expect(res.status).toBe(404);
  });

  it("handles MCP initialize", async () => {
    const res = await mcp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "vitest", version: "0" },
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { serverInfo?: { name?: string } };
    };
    expect(body.result?.serverInfo?.name).toBe("qbo-mcp");
  });

  it("lists all tools without credentials", async () => {
    const res = await mcp({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { tools?: { name: string }[] };
    };
    const names = (body.result?.tools ?? []).map((t) => t.name);
    expect(names).toContain("qbo_navigate");
    expect(names).toContain("qbo_status");
    expect(names).toContain("qbo_customers_list");
    expect(names.length).toBeGreaterThan(10);
  });

  it("returns a graceful error for a credential-requiring tool when unconfigured", async () => {
    const res = await mcp({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "qbo_customers_list", arguments: {} },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { isError?: boolean; content?: { text?: string }[] };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toMatch(
      /QBO_ACCESS_TOKEN|credentials|required/i,
    );
  });

  it("rejects /mcp in gateway mode without credential headers", async () => {
    const res = await mcp(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "qbo_customers_list", arguments: {} },
      },
      { AUTH_MODE: "gateway" },
    );
    expect(res.status).toBe(401);
  });

  it("rejects an invalid X-Qbo-Environment header in gateway mode with 400", async () => {
    const res = await worker.fetch(
      new Request("http://worker.local/mcp", {
        method: "POST",
        headers: {
          ...MCP_HEADERS,
          "X-Qbo-Access-Token": "tok",
          "X-Qbo-Realm-Id": "123",
          "X-Qbo-Environment": "staging",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 5,
          method: "tools/list",
          params: {},
        }),
      }),
      { AUTH_MODE: "gateway", CONDUIT_S2S_SECRET: S2S_SECRET },
    );
    expect(res.status).toBe(400);
  });
});
