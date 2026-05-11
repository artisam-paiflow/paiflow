/**
 * Captures PNGs of the key pages into ./screenshots/.
 *
 * Prereqs (run once):
 *   pnpm docker:up
 *   pnpm db:migrate
 *   pnpm db:seed          # needs ADMIN_SEED_PASSWORD
 *   pnpm exec playwright install chromium
 *
 * Run:
 *   ADMIN_SEED_PASSWORD=… pnpm screenshots
 */
import { test, type Page } from "@playwright/test";

const SHOTS = "screenshots";

async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  await page.screenshot({
    path: `${SHOTS}/${name}.png`,
    fullPage: opts.fullPage ?? true,
    animations: "disabled",
  });
}

// Public pages — run without a logged-in session.
test.describe("public", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("landing", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await shot(page, "01-landing");
  });

  test("login", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await shot(page, "02-login");
  });

  test("register", async ({ page }) => {
    await page.goto("/register");
    await page.waitForLoadState("networkidle");
    await shot(page, "03-register");
  });
});

// Authenticated pages — use the admin session saved by global-setup.
test.describe("authed", () => {
  test("dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await shot(page, "10-dashboard");
  });

  test("builder", async ({ page }) => {
    await page.goto("/flows/new");
    await page.waitForURL(/\/flows\/[0-9a-f-]+$/, { timeout: 15_000 });
    // Wait for React Flow to render at least one node and the English preview.
    await page.waitForSelector(".react-flow__node", { timeout: 15_000 });
    await page.waitForSelector("text=English preview", { timeout: 5_000 });
    // Let autosave + animations settle.
    await page.waitForTimeout(800);
    await shot(page, "11-builder", { fullPage: false });
  });

  test("account", async ({ page }) => {
    await page.goto("/account");
    await page.waitForLoadState("networkidle");
    await shot(page, "12-account");
  });
});
