import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Payment flows against Stripe's test mode: they need test keys and run only by hand (`npm run test:stripe`).
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
    include: ["tests/stripe/**/*.test.ts"],
    setupFiles: ["tests/stripe/setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
