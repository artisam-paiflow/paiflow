import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "subscription-allowance-local.spec.ts",
  timeout: 60_000,
  reporter: "list",
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3390", headless: true },
});
