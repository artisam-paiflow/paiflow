import { defineConfig } from "@playwright/test";

// Separate local fixture run: no admin seed/login or live wallet transactions.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "public-embed-local.spec.ts",
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3377",
    headless: true,
    launchOptions: process.env.CHROMIUM_PATH
      ? {
          executablePath: process.env.CHROMIUM_PATH,
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        }
      : undefined,
  },
});
