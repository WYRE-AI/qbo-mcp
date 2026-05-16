import { describe, it, expect } from "vitest";
import { buildAttachableMetadata } from "../entities/attachable.js";

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
