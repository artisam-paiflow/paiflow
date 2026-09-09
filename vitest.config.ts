import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    globals: false,
    setupFiles: ["tests/unit/setup.ts"],
  },
  resolve: {
    // Vite takes the first matching prefix, so "@" stays last: a longer
    // "@/lib/..." entry has to be able to win. Ordering it first is what made
    // the old tests/stubs/env.ts alias dead (#406).
    alias: {
      "server-only": path.resolve(__dirname, "./tests/stubs/server-only.ts"),
      dotenv: path.resolve(__dirname, "./tests/stubs/dotenv.ts"),
      "@": path.resolve(__dirname, "./"),
    },
  },
});
