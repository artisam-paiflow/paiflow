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
    // Vite takes the first prefix match, so "@" shadows any longer "@/..."
    // entry placed after it. Keep that in mind before adding one.
    alias: {
      "@": path.resolve(__dirname, "./"),
      "server-only": path.resolve(__dirname, "./tests/stubs/server-only.ts"),
      dotenv: path.resolve(__dirname, "./tests/stubs/dotenv.ts"),
    },
  },
});
