import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",

  globalSetup: "./tests/e2e/global-setup.ts",

  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    storageState: "tests/e2e/.auth/admin.json",
    trace: "retain-on-failure",
    video: "off",
    screenshot: "off",
  },

  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.CHROMIUM_PATH
          ? {
              executablePath: process.env.CHROMIUM_PATH,
              args: ["--no-sandbox", "--disable-dev-shm-usage"],
            }
          : undefined,
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        launchOptions: process.env.CHROMIUM_PATH
          ? {
              executablePath: process.env.CHROMIUM_PATH,
              args: ["--no-sandbox", "--disable-dev-shm-usage"],
            }
          : undefined,
      },
    },
  ],

  webServer: process.env.PLAYWRIGHT_NO_SERVER
    ? undefined
    : {
        command: "pnpm dev",
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 120_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
