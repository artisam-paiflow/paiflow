import { describe, expect, it } from "vitest";
import {
  QuoteQuerySchema,
  assetToParam,
  minOut,
  orientReserves,
  parseAssetParam,
  spotOut,
} from "@/lib/soroswap/quote";
import { quoteAlwaysReverts } from "@/lib/soroswap/preview";

const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("QuoteQuerySchema", () => {
  it("parses a realistic query with the default slippage", () => {
    const q = QuoteQuerySchema.parse({
      assetIn: "native",
      assetOut: "USDC",
      amountStroops: "100000000",
    });
    expect(q.assetIn).toEqual({ kind: "native" });
    expect(q.assetOut).toEqual({ kind: "known", symbol: "USDC" });
    expect(q.slippageBps).toBe(100);
  });

  it("parses a custom asset and a coerced slippage", () => {
    const q = QuoteQuerySchema.parse({
      assetIn: `PHP:${ISSUER}`,
      assetOut: "native",
      amountStroops: "1",
      slippageBps: "250",
    });
    expect(q.assetIn).toEqual({ kind: "custom", code: "PHP", issuer: ISSUER });
    expect(q.slippageBps).toBe(250);
  });

  const rejected: Array<[Record<string, unknown>, string]> = [
    [{ assetIn: "native", assetOut: "USDC", amountStroops: "0" }, "zero amount"],
    [{ assetIn: "native", assetOut: "USDC", amountStroops: "-5" }, "negative amount"],
    [{ assetIn: "native", assetOut: "USDC", amountStroops: "1.5" }, "decimal amount"],
    [{ assetIn: "native", assetOut: "USDC", amountStroops: "1e7" }, "float notation"],
    [{ assetIn: "native", assetOut: "native", amountStroops: "1" }, "same asset both sides"],
    [{ assetIn: "BTC", assetOut: "USDC", amountStroops: "1" }, "unknown symbol"],
    [{ assetIn: "PHP:not-an-issuer", assetOut: "USDC", amountStroops: "1" }, "bad issuer"],
    [
      { assetIn: "native", assetOut: "USDC", amountStroops: "1", slippageBps: 10_001 },
      "slippage > 100%",
    ],
    [
      { assetIn: "native", assetOut: "USDC", amountStroops: "1", slippageBps: -1 },
      "negative slippage",
    ],
    [{ assetIn: "native", assetOut: "USDC", amountStroops: "9".repeat(40) }, "absurd amount"],
  ];

  it.each(rejected)("rejects %o (%s)", (input) => {
    expect(QuoteQuerySchema.safeParse(input).success).toBe(false);
  });
});

describe("asset params", () => {
  it("round-trips every asset kind", () => {
    for (const a of [
      { kind: "native" as const },
      { kind: "known" as const, symbol: "USDC" as const },
      { kind: "custom" as const, code: "PHP", issuer: ISSUER },
    ]) {
      expect(parseAssetParam(assetToParam(a))).toEqual(a);
    }
  });
});

describe("stroops maths (mirrors contracts/actions/swapper)", () => {
  // Live XLM/USDC pool on 2026-09-06 (pair CCBX3NZT…): get_reserves returned
  // (4170509596864, 39364110253472) with USDC as token_0 — i.e. ~417k USDC
  // against ~3.94M XLM. The router quoted 10562889 USDC-stroops for 10 XLM.
  const r0 = 4170509596864n; // USDC (token_0)
  const r1 = 39364110253472n; // XLM (token_1)
  const ROUTER_OUTPUT = 10_562_889n;

  it("orients reserves by token_0 and computes spot like the contract", () => {
    const { reserveIn, reserveOut } = orientReserves(r0, r1, false);
    expect(reserveIn).toBe(r1);
    expect(reserveOut).toBe(r0);
    expect(spotOut(100_000_000n, reserveIn, reserveOut)).toBe(10594700n);
  });

  it("the router's real output sits between the 1% minimum and spot", () => {
    const { reserveIn, reserveOut } = orientReserves(r0, r1, false);
    const spot = spotOut(100_000_000n, reserveIn, reserveOut);
    const min = minOut(spot, 100);
    expect(min).toBe(10488753n);
    expect(ROUTER_OUTPUT).toBeGreaterThan(min);
    expect(ROUTER_OUTPUT).toBeLessThan(spot);
    // and at 0 bps the minimum equals spot, which the fee can never clear
    expect(ROUTER_OUTPUT).toBeLessThan(minOut(spot, 0));
  });

  it("flags a slippage the pool fee can never clear", () => {
    const { reserveIn, reserveOut } = orientReserves(r0, r1, false);
    const spot = spotOut(100_000_000n, reserveIn, reserveOut);
    const quote = (slippageBps: number) => ({
      amountOutStroops: ROUTER_OUTPUT.toString(),
      amountOutMinStroops: minOut(spot, slippageBps).toString(),
    });
    // 0.3% fee plus impact: 1% clears it, 0 bps and 10 bps cannot, so the
    // contract's amount_out_min assertion would revert every time.
    expect(quoteAlwaysReverts(quote(100))).toBe(false);
    expect(quoteAlwaysReverts(quote(10))).toBe(true);
    expect(quoteAlwaysReverts(quote(0))).toBe(true);
  });

  it("does not flag a minimum that merely equals the expected output", () => {
    expect(
      quoteAlwaysReverts({ amountOutStroops: "10562889", amountOutMinStroops: "10562889" }),
    ).toBe(false);
  });

  it("returns 0 for empty reserves or a non-positive amount", () => {
    expect(spotOut(0n, 1n, 1n)).toBe(0n);
    expect(spotOut(1n, 0n, 1n)).toBe(0n);
    expect(spotOut(1n, 1n, 0n)).toBe(0n);
  });

  it("rejects slippage outside 0–10000", () => {
    expect(() => minOut(1n, 10_001)).toThrow(RangeError);
    expect(() => minOut(1n, -1)).toThrow(RangeError);
    expect(minOut(1_000n, 10_000)).toBe(0n);
    expect(minOut(1_000n, 0)).toBe(1_000n);
  });
});
