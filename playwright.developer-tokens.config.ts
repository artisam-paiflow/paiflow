import { defineConfig } from "@playwright/test";

// Prevent failure-context DOM snapshots from retaining one-time credentials.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

// Explicit opt-in runner: no stored sessions, traces, screenshots or live financial calls.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "developer-tokens-local.spec.ts",
  workers: 1,
  timeout: 180_000,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3384",
    headless: true,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
