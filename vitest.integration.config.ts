import { defineConfig } from "vitest/config";

/**
 * Vitest config for the real-API integration suite (`npm run test:integration`).
 * Default `npm test` excludes these files via the package.json script; this
 * config flips the filter so only the integration suite runs.
 */
export default defineConfig({
  test: {
    include: ["**/*.integration.test.ts"],
  },
});
