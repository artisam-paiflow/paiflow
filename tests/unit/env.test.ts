/**
 * Verifies the env-helper fail-fast contract:
 *   - `stellarRpcUrl(network)` / `stellarPassphrase(network)` throw when the
 *     caller asks for a network that doesn't match `STELLAR_NETWORK`.
 *   - Called without an argument, the helpers return the active network's URL.
 *
 * These drive `lib/env.ts` by mutating `process.env` and clearing its memoized
 * parse via `vi.resetModules()`. `tests/unit/setup.ts` scrubs the ambient
 * environment once per test file, not per case: cleanliness between the
 * describes below comes from their own `beforeEach` deletes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const requiredEnv = {
  AUTH_SECRET: "test_auth_secret_at_least_32_chars_long",
  DATABASE_URL: "postgresql://paiflow:paiflow@localhost:5432/paiflow",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};

async function loadEnv(stellarNetwork: "testnet" | "mainnet") {
  for (const [k, v] of Object.entries(requiredEnv)) process.env[k] = v;
  process.env.STELLAR_NETWORK = stellarNetwork;
  vi.resetModules();
  return await import("@/lib/env");
}

describe("env helpers — fail-fast on network mismatch", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns testnet URLs when STELLAR_NETWORK=testnet", async () => {
    const mod = await loadEnv("testnet");
    expect(mod.stellarRpcUrl()).toContain("testnet");
    expect(mod.stellarHorizonUrl()).toContain("testnet");
    expect(mod.stellarPassphrase()).toBe("Test SDF Network ; September 2015");
  });

  it("returns mainnet URLs when STELLAR_NETWORK=mainnet", async () => {
    const mod = await loadEnv("mainnet");
    expect(mod.stellarRpcUrl()).not.toContain("testnet");
    expect(mod.stellarHorizonUrl()).not.toContain("testnet");
    expect(mod.stellarPassphrase()).toBe("Public Global Stellar Network ; September 2015");
  });

  it("throws when explicit network arg doesn't match STELLAR_NETWORK (testnet→mainnet ask)", async () => {
    const mod = await loadEnv("testnet");
    expect(() => mod.stellarRpcUrl("mainnet")).toThrow(/network mismatch/i);
    expect(() => mod.stellarHorizonUrl("mainnet")).toThrow(/network mismatch/i);
    expect(() => mod.stellarPassphrase("mainnet")).toThrow(/network mismatch/i);
  });

  it("throws when explicit network arg doesn't match STELLAR_NETWORK (mainnet→testnet ask)", async () => {
    const mod = await loadEnv("mainnet");
    expect(() => mod.stellarRpcUrl("testnet")).toThrow(/network mismatch/i);
    expect(() => mod.stellarHorizonUrl("testnet")).toThrow(/network mismatch/i);
    expect(() => mod.stellarPassphrase("testnet")).toThrow(/network mismatch/i);
  });

  it("friendbot throws on mainnet", async () => {
    const mod = await loadEnv("mainnet");
    expect(() => mod.stellarFriendbotUrl()).toThrow(/not available on mainnet/i);
  });
});

describe("env — PDAX deposit address validation", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.OFFRAMP_PDAX_DEPOSIT_ADDRESS_TESTNET;
  });

  it("accepts a valid Stellar ed25519 address", async () => {
    process.env.OFFRAMP_PDAX_DEPOSIT_ADDRESS_TESTNET =
      "GCK2MUVH6TABTXT4247CIEC5EO24CQQ4MZNW7EGBTP3TPGALLQI7P34G";
    const mod = await loadEnv("testnet");
    expect(mod.offRampPdaxDepositConfig().address).toBe(
      "GCK2MUVH6TABTXT4247CIEC5EO24CQQ4MZNW7EGBTP3TPGALLQI7P34G",
    );
  });

  it("throws at load on a malformed deposit address", async () => {
    process.env.OFFRAMP_PDAX_DEPOSIT_ADDRESS_TESTNET = "not-a-stellar-address";
    const mod = await loadEnv("testnet");
    expect(() => mod.env()).toThrow(/valid Stellar ed25519 public key/i);
  });
});

describe("env — analytics", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.OFFRAMP_PDAX_DEPOSIT_ADDRESS_TESTNET;
    delete process.env.NEXT_PUBLIC_APP_ENV;
    delete process.env.POSTHOG_HOST;
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_ENV;
    delete process.env.POSTHOG_HOST;
  });

  it("defaults an absent NEXT_PUBLIC_APP_ENV to local", async () => {
    const mod = await loadEnv("testnet");
    expect(mod.env().NEXT_PUBLIC_APP_ENV).toBe("local");
  });

  it("throws on a misspelled NEXT_PUBLIC_APP_ENV instead of tagging events local", async () => {
    process.env.NEXT_PUBLIC_APP_ENV = "betaa";
    const mod = await loadEnv("testnet");
    expect(() => mod.env()).toThrow();
  });

  it("throws on a plaintext POSTHOG_HOST", async () => {
    process.env.POSTHOG_HOST = "http://us.i.posthog.com";
    const mod = await loadEnv("testnet");
    expect(() => mod.env()).toThrow(/POSTHOG_HOST must use https/);
  });
});

describe("env — splitter hard limits", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.OFFRAMP_PDAX_DEPOSIT_ADDRESS_TESTNET;
    delete process.env.NEXT_PUBLIC_SPLITTER_XLM_MIN;
    delete process.env.NEXT_PUBLIC_SPLITTER_XLM_MAX;
    delete process.env.NEXT_PUBLIC_SPLITTER_USDC_MIN;
    delete process.env.NEXT_PUBLIC_SPLITTER_USDC_MAX;
  });

  it("uses defaults when unset", async () => {
    const mod = await loadEnv("testnet");
    const e = mod.env();
    expect(e.NEXT_PUBLIC_SPLITTER_XLM_MIN).toBe(150);
    expect(e.NEXT_PUBLIC_SPLITTER_XLM_MAX).toBe(500);
    expect(e.NEXT_PUBLIC_SPLITTER_USDC_MIN).toBe(30);
    expect(e.NEXT_PUBLIC_SPLITTER_USDC_MAX).toBe(110);
  });

  it("parses custom values", async () => {
    process.env.NEXT_PUBLIC_SPLITTER_XLM_MIN = "10";
    process.env.NEXT_PUBLIC_SPLITTER_XLM_MAX = "1000";
    process.env.NEXT_PUBLIC_SPLITTER_USDC_MIN = "5";
    process.env.NEXT_PUBLIC_SPLITTER_USDC_MAX = "500";
    const mod = await loadEnv("testnet");
    const e = mod.env();
    expect(e.NEXT_PUBLIC_SPLITTER_XLM_MIN).toBe(10);
    expect(e.NEXT_PUBLIC_SPLITTER_XLM_MAX).toBe(1000);
    expect(e.NEXT_PUBLIC_SPLITTER_USDC_MIN).toBe(5);
    expect(e.NEXT_PUBLIC_SPLITTER_USDC_MAX).toBe(500);
  });

  it("falls back to defaults on malformed values instead of crashing env()", async () => {
    // A typo in one of these temporary knobs must not take down every route
    // that calls env() — the schema catches the failure and uses the default.
    process.env.NEXT_PUBLIC_SPLITTER_XLM_MIN = "abc";
    process.env.NEXT_PUBLIC_SPLITTER_USDC_MAX = "150.5";
    const mod = await loadEnv("testnet");
    const e = mod.env();
    expect(e.NEXT_PUBLIC_SPLITTER_XLM_MIN).toBe(150);
    expect(e.NEXT_PUBLIC_SPLITTER_USDC_MAX).toBe(110);
  });
});

describe("env — the sandbox is testnet-only", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.SANDBOX_ENABLED;
  });

  it("refuses to boot with SANDBOX_ENABLED on mainnet", async () => {
    // The sandbox hands a working session to anyone who asks, with no account
    // and no credential. On mainnet that would point an anonymous visitor at
    // real money, so the combination fails closed rather than relying on an
    // operator remembering to unset it during a cutover.
    process.env.SANDBOX_ENABLED = "true";
    const mod = await loadEnv("mainnet");
    expect(() => mod.env()).toThrow(/SANDBOX_ENABLED/);
    expect(() => mod.env()).toThrow(/mainnet/);
  });

  it("allows it on testnet", async () => {
    process.env.SANDBOX_ENABLED = "true";
    const mod = await loadEnv("testnet");
    expect(mod.env().SANDBOX_ENABLED).toBe(true);
  });

  it("leaves mainnet alone when the sandbox is off", async () => {
    const mod = await loadEnv("mainnet");
    expect(mod.env().SANDBOX_ENABLED).toBe(false);
  });
});

describe("env — passkey origins", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.AUTH_ORIGINS;
    delete process.env.AUTH_URL;
  });

  afterEach(() => {
    delete process.env.AUTH_ORIGINS;
    delete process.env.AUTH_URL;
  });

  it("parses a comma-separated list, trimming whitespace", async () => {
    process.env.AUTH_ORIGINS = "https://paiflow.xyz, https://beta.app.paiflow.xyz";
    const mod = await loadEnv("testnet");
    expect(mod.env().AUTH_ORIGINS).toEqual(["https://paiflow.xyz", "https://beta.app.paiflow.xyz"]);
  });

  it("is empty when unset, so rp() can fall back to AUTH_URL", async () => {
    const mod = await loadEnv("testnet");
    expect(mod.env().AUTH_ORIGINS).toEqual([]);
  });

  it("rejects an entry that is not a URL", async () => {
    // WebAuthn compares this against the browser's origin verbatim, so a bare
    // hostname would silently never match rather than failing loudly here.
    process.env.AUTH_ORIGINS = "https://paiflow.xyz,beta.app.paiflow.xyz";
    const mod = await loadEnv("testnet");
    expect(() => mod.env()).toThrow(/AUTH_ORIGINS/);
  });
});
