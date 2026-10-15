import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => {
  delete process.env.STELLAR_RELAYER_MAX_FEE_STROOPS;
});

describe("optional relayer total fee ceiling", () => {
  it("leaves the existing invocation policy unchanged when unset", async () => {
    const { env } = await import("@/lib/env");
    expect(env().STELLAR_RELAYER_MAX_FEE_STROOPS).toBeUndefined();
  });

  it.each(["1", "10000000", "4294967295"])(
    "retains the exact valid uint32 fee %s",
    async (value) => {
      process.env.STELLAR_RELAYER_MAX_FEE_STROOPS = value;
      const { env } = await import("@/lib/env");
      expect(env().STELLAR_RELAYER_MAX_FEE_STROOPS).toBe(value);
    },
  );

  it.each([
    "",
    "0",
    "-1",
    "1.5",
    "01",
    " 10",
    "10 ",
    "+10",
    "1e7",
    "NaN",
    "4294967296",
    "9223372036854775807",
  ])("rejects invalid or out-of-range fee %j", async (value) => {
    process.env.STELLAR_RELAYER_MAX_FEE_STROOPS = value;
    const { env } = await import("@/lib/env");
    expect(() => env()).toThrow();
  });
});
