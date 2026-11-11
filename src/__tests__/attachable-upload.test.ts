import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ATTACHABLE_ENTITY_TYPES,
  attachableExtras,
  buildAttachableMetadata,
} from "../entities/attachable.js";
import { createMcpServer } from "../mcp-server.js";

const { postMultipart } = vi.hoisted(() => ({
  postMultipart: vi.fn(async (path: string) => ({ path })),
}));

vi.mock("../utils/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/client.js")>()),
  getClient: () => ({ postMultipart }),
}));

const uploadTool = () => attachableExtras.tools![0]!;

describe("buildAttachableMetadata", () => {
  it("produces the minimum required shape: filename + content type + empty AttachableRef", () => {
    const meta = buildAttachableMetadata({
      fileName: "receipt.pdf",
      contentType: "application/pdf",
    });
    expect(meta).toEqual({
      FileName: "receipt.pdf",
      ContentType: "application/pdf",
      AttachableRef: [],
    });
  });

  it("attaches to a transaction when both type and id are provided", () => {
    const meta = buildAttachableMetadata({
      fileName: "po.pdf",
      contentType: "application/pdf",
      attachToType: "PurchaseOrder",
      attachToId: "42",
      includeOnSend: true,
    });
    expect(meta.AttachableRef).toEqual([
      {
        EntityRef: { type: "PurchaseOrder", value: "42" },
        IncludeOnSend: true,
      },
    ]);
  });

  it("does not attach when only one of (type, id) is provided", () => {
    expect(
      buildAttachableMetadata({
        fileName: "x.pdf",
        contentType: "application/pdf",
        attachToType: "Invoice",
        // no attachToId
      }).AttachableRef,
    ).toEqual([]);
  });

  it("defaults IncludeOnSend to false when omitted", () => {
    const meta = buildAttachableMetadata({
      fileName: "x.pdf",
      contentType: "application/pdf",
      attachToType: "Invoice",
      attachToId: "10",
    });
    expect((meta.AttachableRef as Array<{ IncludeOnSend: boolean }>)[0]?.IncludeOnSend).toBe(false);
  });

  it("includes optional note and category when provided", () => {
    const meta = buildAttachableMetadata({
      fileName: "x.pdf",
      contentType: "application/pdf",
      note: "Customer-supplied receipt",
      category: "Receipt",
    });
    expect(meta).toMatchObject({
      Note: "Customer-supplied receipt",
      Category: "Receipt",
    });
  });

  it("omits Note and Category when not provided", () => {
    const meta = buildAttachableMetadata({
      fileName: "x.pdf",
      contentType: "application/pdf",
    });
    expect(meta).not.toHaveProperty("Note");
    expect(meta).not.toHaveProperty("Category");
  });
});

describe("qbo_attachables_upload handler", () => {
  const base = {
    fileName: "r.pdf",
    contentType: "application/pdf",
    base64Data: "aGVsbG8=",
  };
  const upload = (args: Record<string, unknown>) =>
    attachableExtras.handlers!.qbo_attachables_upload!({ ...base, ...args });

  beforeEach(() => {
    postMultipart.mockClear();
  });

  it.each([
    { attachToId: "1" },
    { attachToType: "Invoice" },
    { attachToId: "1", attachToType: "" },
    { attachToId: "", attachToType: "Invoice" },
  ])("rejects one-sided args %j", async (args) => {
    const result = await upload(args);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/must be given together/);
    expect(postMultipart).not.toHaveBeenCalled();
  });

  it("rejects a type outside the allow-list and lists the allowed values", async () => {
    const result = await upload({ attachToType: "Account", attachToId: "1" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Invoice");
    expect(postMultipart).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric attachToId", async () => {
    await expect(
      upload({ attachToType: "Invoice", attachToId: "1/../2" }),
    ).rejects.toThrow(/Invalid attachToId/);
    expect(postMultipart).not.toHaveBeenCalled();
  });

  it("uploads with no attachment target", async () => {
    const result = await upload({});
    expect(result.isError).toBeUndefined();
    expect(postMultipart).toHaveBeenCalledTimes(1);
  });

  it("uploads a valid type/id pair", async () => {
    const result = await upload({ attachToType: "Invoice", attachToId: "130" });
    expect(result.isError).toBeUndefined();
    expect(postMultipart).toHaveBeenCalledTimes(1);
    expect(postMultipart.mock.calls[0]?.[0]).toBe("upload");
  });

  it("restricts the schema enum to the allow-list", () => {
    const props = (uploadTool().inputSchema.properties ?? {}) as Record<
      string,
      { enum?: string[] }
    >;
    expect(props.attachToType?.enum).toEqual([...ATTACHABLE_ENTITY_TYPES]);
  });
});

describe("tool annotations", () => {
  it("marks upload destructive", () => {
    expect(uploadTool().annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });

  it("marks qbo_navigate and qbo_status read-only", async () => {
    const server = createMcpServer();
    const client = new Client({ name: "test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const { tools } = await client.listTools();
    for (const name of ["qbo_navigate", "qbo_status"]) {
      expect(tools.find((t) => t.name === name)?.annotations).toEqual({
        readOnlyHint: true,
      });
    }
    await client.close();
  });
});
