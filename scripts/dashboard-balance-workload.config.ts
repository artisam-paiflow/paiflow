import path from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rehearsal/dashboard-balance-workload.test.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
  },
  resolve: {
    alias: {
      "server-only": path.resolve("tests/stubs/server-only.ts"),
      dotenv: path.resolve("tests/stubs/dotenv.ts"),
      "@": path.resolve("."),
    },
  },
});
