/**
 * `rp().origin` is what `@simplewebauthn/server` compares the browser's origin
 * against, verbatim. The app service answers on two hostnames, so this has to be
 * the AUTH_ORIGINS list — and has to keep falling back to AUTH_URL where that
 * list is deliberately blank, which is every other environment including local
 * dev. The fallback is the half the deploy sequence leans on: AUTH_ORIGINS is
 * set on the service *before* AUTH_URL is removed, and until it is set the
 * passkey origin is still AUTH_URL. See .railway/railway.ts.
 *
 * `vitest.config.ts` aliases `server-only` to a stub, so lib/passkey/rp.ts
 * imports fine here; env()'s memoised parse is cleared with vi.resetModules().
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

async function loadRp() {
  process.env.AUTH_SECRET = "test_auth_secret_at_least_32_chars_long";
  process.env.DATABASE_URL = "postgresql://paiflow:paiflow@localhost:5432/paiflow";
  vi.resetModules();
  return await import("@/lib/passkey/rp");
}

describe("rp() — the origin passkeys are verified against", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.AUTH_ORIGINS;
    delete process.env.AUTH_URL;
  });

  afterEach(() => {
    delete process.env.AUTH_ORIGINS;
    delete process.env.AUTH_URL;
  });

  it("is every configured origin, so one service can answer on several hostnames", async () => {
    process.env.AUTH_ORIGINS = "https://paiflow.xyz,https://beta.app.paiflow.xyz";
    process.env.AUTH_URL = "https://paiflow.xyz";
    const { rp } = await loadRp();
    expect(rp().origin).toEqual(["https://paiflow.xyz", "https://beta.app.paiflow.xyz"]);
  });

  it("falls back to AUTH_URL when no origins are configured", async () => {
    process.env.AUTH_URL = "http://localhost:3000";
    const { rp } = await loadRp();
    expect(rp().origin).toEqual(["http://localhost:3000"]);
  });
});
