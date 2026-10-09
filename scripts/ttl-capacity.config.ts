import path from "node:path";
import { defineConfig } from "vitest/config";

/** Opt-in local integration rehearsal; never included in ordinary unit tests/CI. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rehearsal/ttl-capacity.test.ts"],
    setupFiles: ["tests/rehearsal/ttl-capacity-setup.ts"],
    testTimeout: 180_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "server-only": path.resolve("tests/stubs/server-only.ts"),
      dotenv: path.resolve("tests/stubs/dotenv.ts"),
      "@": path.resolve("."),
    },
  },
});
