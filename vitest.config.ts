import { defineConfig } from "vitest/config";

// vite.config.ts exists solely to build the MCP Apps invoice-card UI and sets
// root: "ui". vitest prefers vitest.config.ts, so this file keeps unit tests
// running from the repo root instead of inheriting that root and finding no
// tests. (Integration runs pass --config vitest.integration.config.ts and are
// unaffected.)
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
