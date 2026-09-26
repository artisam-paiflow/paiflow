import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // tsconfig.json has `jsx: "preserve"` for Next, and Vite copies it into
  // esbuild, which would then emit raw JSX into a .tsx test. Setting the
  // runtime here overrides it. On Vite 8 the key becomes `oxc.jsx`.
  esbuild: { jsx: "automatic" },
  test: {
    globals: false,
    // Only listed projects run. A test file that matches neither include is
    // skipped without a warning; tests/unit/test-config.test.ts guards that.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
          setupFiles: ["tests/unit/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["tests/unit/**/*.test.tsx"],
          setupFiles: ["tests/unit/setup.ts", "tests/unit/setup-dom.ts"],
        },
      },
    ],
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
