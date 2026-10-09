import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  delete process.env.STELLAR_TTL_MAINTENANCE_ENABLED;
  delete process.env.STELLAR_TTL_MAX_FEE_STROOPS;
  delete process.env.STELLAR_TTL_FEE_BUDGET_NAME;
  delete process.env.STELLAR_TTL_FEE_BUDGET_STROOPS;
});
describe("TTL maintenance configuration", () => {
  it.each(["STELLAR_TTL_FEE_BUDGET_NAME", "STELLAR_TTL_FEE_BUDGET_STROOPS"])(
    "rejects half-configured budget %s",
    async (key) => {
      process.env[key] = key.endsWith("NAME") ? "ttl804-testnet-20261004" : "1500000000";
      const { env } = await import("@/lib/env");
      expect(() => env()).toThrow("configured together");
    },
  );
  it.each(["", "0", "-1", "1.5", "01", " 10"])(
    "rejects invalid cumulative ceiling %j",
    async (value) => {
      process.env.STELLAR_TTL_FEE_BUDGET_NAME = "ttl804-testnet-20261004";
      process.env.STELLAR_TTL_FEE_BUDGET_STROOPS = value;
      const { env } = await import("@/lib/env");
      expect(() => env()).toThrow();
    },
  );
  it("defaults to inventory only and a bounded string fee", async () => {
    const { env } = await import("@/lib/env");
    expect(env().STELLAR_TTL_MAINTENANCE_ENABLED).toBe(false);
    expect(env().STELLAR_TTL_MAX_FEE_STROOPS).toBe("1000000");
  });
  it("requires explicit true to enable writes and retains exact large integer fees", async () => {
    process.env.STELLAR_TTL_MAINTENANCE_ENABLED = "true";
    process.env.STELLAR_TTL_MAX_FEE_STROOPS = "9007199254740993";
    const { env } = await import("@/lib/env");
    expect(env().STELLAR_TTL_MAINTENANCE_ENABLED).toBe(true);
    expect(env().STELLAR_TTL_MAX_FEE_STROOPS).toBe("9007199254740993");
  });
  it.each(["", "0", "-1", "1.5", "1e7", "01", " 10", "NaN", "100000000000000000000"])(
    "rejects invalid fee %j",
    async (value) => {
      process.env.STELLAR_TTL_MAX_FEE_STROOPS = value;
      const { env } = await import("@/lib/env");
      expect(() => env()).toThrow();
    },
  );
  it.each(["", "1", "yes", "TRUE"])("rejects accidental enable %j", async (value) => {
    process.env.STELLAR_TTL_MAINTENANCE_ENABLED = value;
    const { env } = await import("@/lib/env");
    expect(() => env()).toThrow();
  });
});
