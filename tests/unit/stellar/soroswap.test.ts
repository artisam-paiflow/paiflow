/**
 * Instawards D1 (#391): the RPC-facing half of the swap quote preview. The pure
 * maths is covered in tests/unit/soroswap/quote.test.ts; what matters here is
 * that a bad decode fails loudly instead of rendering as a plausible number.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ROUTER = "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD";
const FACTORY = "CADMRKVJHWAKO2ECTNQALFZ7VEXDIYJIJG3ZSEGIX2HDWADM7EOGCYDG";
const PAIR = "CCBX3NZTCQLQFSPG7HBOKL4P2RVPOPVFHDNRTOSCCJWBTPL2GHEH7RQS";
const XLM_SAC = "CDLLYSUI3U4BZBQXQJENHZUHTO4PQ2X54LSVSPQ3SQXC6RAGJYIKGKV6";
const USDC_SAC = "CCH3TIPZCI35FM3BOOBQA4JLLTU6KYOPQEFKWQMYMR5P2J47G3BZDWWN";

// Live XLM/USDC pool on 2026-09-06, the same reserves quote.test.ts pins:
// USDC is token_0, so 10 XLM spots at 10594700 and bounds at 10488753 (1%).
const USDC_RESERVE = 4170509596864n;
const XLM_RESERVE = 39364110253472n;
const TEN_XLM = "100000000";
const ROUTER_OUTPUT = 10_562_889n;
const SPOT = 10_594_700n;
const MIN_1PCT = 10_488_753n;

const stub = vi.hoisted(() => ({
  router: undefined as string | undefined,
  cacheBuilds: 0,
  getPair: undefined as (() => unknown) | undefined,
  reserves: undefined as unknown,
  token0: undefined as unknown,
  amountsOut: undefined as unknown,
}));

vi.mock("@/lib/env", () => ({
  env: () => ({ LOG_LEVEL: "silent" }),
  soroswapRouterAddress: () => stub.router,
  SWAP_ROUTER_UNSET_MESSAGE: "Swap flows need the Soroswap router address.",
}));

vi.mock("@/lib/stellar/assets", () => ({
  assetContractId: (a: { kind: string }) => (a.kind === "native" ? XLM_SAC : USDC_SAC),
}));

// Pass-through cache: the point of the counter is to prove readSoroswapPool goes
// through cachedSoroswapFactoryReader rather than reading the factory raw.
vi.mock("@/lib/contract-read-cache", () => ({
  createContractReadCache: () => {
    stub.cacheBuilds += 1;
    return <TArgs extends unknown[], TReturn>(
      _name: string,
      fn: (...args: TArgs) => Promise<TReturn>,
    ) => fn;
  },
}));

vi.mock("@/lib/stellar/relayer", () => ({
  simulateGetter: vi.fn(async (address: string, fn: string) => {
    if (address === ROUTER && fn === "get_factory") return FACTORY;
    throw new Error(`unexpected getter ${fn}@${address}`);
  }),
  simulateContractCall: vi.fn(async (address: string, fn: string) => {
    if (address === FACTORY && fn === "get_pair") return stub.getPair!();
    if (address === PAIR && fn === "get_reserves") return stub.reserves;
    if (address === PAIR && fn === "token_0") return stub.token0;
    if (address === ROUTER && fn === "router_get_amounts_out") return stub.amountsOut;
    throw new Error(`unexpected call ${fn}@${address}`);
  }),
}));

import { AppError } from "@/lib/errors";
import { readSoroswapQuote } from "@/lib/stellar/soroswap";

const NATIVE_TO_USDC = {
  assetIn: { kind: "native" } as const,
  assetOut: { kind: "known", symbol: "USDC" } as const,
  amountStroops: TEN_XLM,
  slippageBps: 100,
};

describe("readSoroswapQuote", () => {
  beforeEach(() => {
    stub.router = ROUTER;
    stub.cacheBuilds = 0;
    stub.getPair = () => PAIR;
    stub.reserves = [USDC_RESERVE, XLM_RESERVE];
    stub.token0 = USDC_SAC;
    stub.amountsOut = [BigInt(TEN_XLM), ROUTER_OUTPUT];
  });

  it("orients reserves by token_0 and returns both numbers as strings", async () => {
    const q = await readSoroswapQuote(NATIVE_TO_USDC);
    expect(q).toEqual({
      amountOutStroops: ROUTER_OUTPUT.toString(),
      amountOutMinStroops: MIN_1PCT.toString(),
      pairAddress: PAIR,
      routerAddress: ROUTER,
    });
    expect(typeof q.amountOutMinStroops).toBe("string");
    // The bound the contract asserts sits below the router's real output.
    expect(BigInt(q.amountOutStroops)).toBeGreaterThan(BigInt(q.amountOutMinStroops));
    expect(BigInt(q.amountOutMinStroops)).toBeLessThan(SPOT);
  });

  it("orients the other way when token_0 is the input asset", async () => {
    stub.token0 = XLM_SAC;
    stub.reserves = [XLM_RESERVE, USDC_RESERVE];
    const q = await readSoroswapQuote(NATIVE_TO_USDC);
    expect(q.amountOutMinStroops).toBe(MIN_1PCT.toString());
  });

  it("resolves the factory through the cached reader", async () => {
    await readSoroswapQuote(NATIVE_TO_USDC);
    expect(stub.cacheBuilds).toBe(1);
  });

  const unusable: Array<[string, unknown]> = [
    ["an empty vec", []],
    ["a scalar", 10_562_889n],
    ["a trailing zero", [BigInt(TEN_XLM), 0n]],
    ["a non-bigint element", [BigInt(TEN_XLM), "10562889"]],
  ];

  it.each(unusable)("rejects a router quote that decodes to %s", async (_label, value) => {
    stub.amountsOut = value;
    await expect(readSoroswapQuote(NATIVE_TO_USDC)).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
      message: expect.stringContaining("unusable quote"),
    });
  });

  it("rejects a token_0 that is neither side of the pair rather than inverting silently", async () => {
    stub.token0 = {};
    await expect(readSoroswapQuote(NATIVE_TO_USDC)).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
      message: expect.stringContaining("unexpected token_0"),
    });
  });

  it("reports a failing get_pair as a missing pool, keeping the reason in details", async () => {
    stub.getPair = () => {
      throw new AppError("UPSTREAM_RPC", "get_pair() simulation failed: PairDoesNotExist");
    };
    await expect(readSoroswapQuote(NATIVE_TO_USDC)).rejects.toMatchObject({
      code: "VALIDATION",
      message: "Soroswap has no liquidity pool for this asset pair on this network.",
      details: expect.stringContaining("PairDoesNotExist"),
    });
  });

  it("does not disguise an unfunded relayer as a missing pool", async () => {
    stub.getPair = () => {
      throw new AppError("INSUFFICIENT_FUNDS", "Relayer account GXXX is not funded");
    };
    await expect(readSoroswapQuote(NATIVE_TO_USDC)).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS",
      message: expect.stringContaining("not funded"),
    });
  });

  it("asks for the router address before touching the network", async () => {
    stub.router = undefined;
    await expect(readSoroswapQuote(NATIVE_TO_USDC)).rejects.toMatchObject({
      code: "VALIDATION",
      message: expect.stringContaining("Soroswap router address"),
    });
  });
});
