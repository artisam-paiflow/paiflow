import { chromium, request, type FullConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const STORAGE = "tests/e2e/.auth/admin.json";

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:3000";
  const username = process.env.ADMIN_SEED_USERNAME ?? "admin";
  const password = process.env.ADMIN_SEED_PASSWORD;

  if (!password) {
    throw new Error(
      "ADMIN_SEED_PASSWORD must be set in the environment for Playwright screenshots.",
    );
  }

  mkdirSync(dirname(STORAGE), { recursive: true });

  // Wait for the app to come up by hitting /api/health.
  const apiCtx = await request.newContext({ baseURL });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const r = await apiCtx.get("/api/health");
      if (r.ok()) break;
    } catch {
      /* keep trying */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await apiCtx.dispose();

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(`${baseURL}/login`);
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);

  await page.context().storageState({ path: STORAGE });
  await browser.close();
}
