import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  delete process.env.STELLAR_TTL_MAINTENANCE_ENABLED;
  delete process.env.STELLAR_TTL_MAX_FEE_STROOPS;
});
describe("TTL maintenance configuration", () => {
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
