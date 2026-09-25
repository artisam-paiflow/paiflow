import { chromium, request, type FullConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const STORAGE = "tests/e2e/.auth/admin.json";

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:3000";
  mkdirSync(dirname(STORAGE), { recursive: true });

  // Evidence runs against paiflow.xyz (#637) sign in as a disposable sandbox
  // user, so no real account's password leaves the operator's machine.
  if (process.env.PLAYWRIGHT_SANDBOX === "1") {
    await sandboxLogin(baseURL);
    return;
  }

  const username = process.env.ADMIN_SEED_USERNAME ?? "admin";
  const password = process.env.ADMIN_SEED_PASSWORD;

  if (!password) {
    throw new Error(
      "ADMIN_SEED_PASSWORD must be set in the environment for Playwright screenshots.",
    );
  }

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

  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH
      ? {
          executablePath: process.env.CHROMIUM_PATH,
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        }
      : undefined,
  );
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

/**
 * The same single-use ticket handshake the login page's "Try the sandbox"
 * button runs: mint, then redeem the ticket through the credentials provider.
 */
async function sandboxLogin(baseURL: string) {
  const api = await request.newContext({ baseURL });
  const mint = await api.post("/api/auth/sandbox");
  if (mint.status() !== 201) {
    throw new Error(`POST /api/auth/sandbox returned ${mint.status()}: ${await mint.text()}`);
  }
  const { ticket } = (await mint.json()).data as { ticket: string };
  const { csrfToken } = (await (await api.get("/api/auth/csrf")).json()) as { csrfToken: string };
  await api.post("/api/auth/callback/credentials", {
    form: { csrfToken, passkeyTicket: ticket, json: "true" },
    maxRedirects: 0,
  });
  const session = (await (await api.get("/api/auth/session")).json()) as {
    user?: { role?: string };
  } | null;
  if (session?.user?.role !== "SANDBOX") {
    throw new Error("The sandbox ticket did not produce a SANDBOX session.");
  }
  await api.storageState({ path: STORAGE });
  await api.dispose();
}
