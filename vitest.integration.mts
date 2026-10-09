import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Integration tests talk to the local Supabase stack (`npm run db:start`). Run with `npm run test:db`.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // Server modules are imported directly here, outside a Next.js build.
      "server-only": fileURLToPath(new URL("./tests/integration/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Tests share one database; run files one after another.
    fileParallelism: false,
  },
});
