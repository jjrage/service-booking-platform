import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // Unit tests cover pure domain and config code; UI flows are covered by Playwright later.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
