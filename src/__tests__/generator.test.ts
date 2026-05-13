import { describe, it, expect } from "vitest";
import {
  generateEntityTools,
  dispatchEntityTool,
} from "../entities/generator.js";
import type { EntityConfig, EntityExtras } from "../entities/types.js";

const sampleConfig: EntityConfig = {
  name: "Widget",
  toolPrefix: "qbo_widgets",
  description: "Widget testing entity",
  list: { dateRange: true },
  get: { idParam: "widgetId" },
  create: {
    fields: [
      { name: "DisplayName", type: "string", required: true, description: "Name" },
      { name: "Quantity", type: "number", description: "Stock count" },
    ],
  },
  update: {
    idParam: "widgetId",
    fields: [
      { name: "DisplayName", type: "string", description: "Name" },
      { name: "Quantity", type: "number", description: "Stock count" },
    ],
  },
  search: { field: "DisplayName" },
};

describe("generateEntityTools", () => {
  it("emits one tool per declared op", () => {
    const tools = generateEntityTools(sampleConfig);
    expect(tools.map((t) => t.name)).toEqual([
      "qbo_widgets_list",
      "qbo_widgets_get",
      "qbo_widgets_create",
      "qbo_widgets_update",
      "qbo_widgets_search",
    ]);
  });

  it("includes startDate/endDate on list when dateRange is set", () => {
    const [list] = generateEntityTools(sampleConfig);
    const props = (list.inputSchema as { properties: Record<string, unknown> })
      .properties;
    expect(props).toHaveProperty("startDate");
    expect(props).toHaveProperty("endDate");
  });

  it("requires Id + SyncToken on update, plus any required create fields", () => {
    const tools = generateEntityTools(sampleConfig);
    const update = tools.find((t) => t.name === "qbo_widgets_update")!;
    const req = (update.inputSchema as { required: string[] }).required;
    expect(req).toContain("widgetId");
    expect(req).toContain("SyncToken");
  });

  it("omits ops that aren't declared on the config", () => {
    const minimal: EntityConfig = {
      name: "Tiny",
      toolPrefix: "qbo_tinies",
      description: "Just get + list",
      list: {},
      get: { idParam: "tinyId" },
    };
    const tools = generateEntityTools(minimal);
    expect(tools.map((t) => t.name)).toEqual(["qbo_tinies_list", "qbo_tinies_get"]);
  });
});

describe("dispatchEntityTool", () => {
  it("returns null for tools not belonging to this config", async () => {
    const result = await dispatchEntityTool(
      sampleConfig,
      undefined,
      "qbo_other_list",
      {}
    );
    expect(result).toBeNull();
  });

  it("prefers extra handlers over built-in dispatch", async () => {
    const extras: EntityExtras = {
      handlers: {
        qbo_widgets_list: async () => ({
          content: [{ type: "text", text: "from override" }],
        }),
      },
    };
    const result = await dispatchEntityTool(
      sampleConfig,
      extras,
      "qbo_widgets_list",
      {}
    );
    expect(result?.content[0]?.text).toBe("from override");
  });
});
