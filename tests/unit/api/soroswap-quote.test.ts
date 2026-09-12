import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireSession: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn(async () => {}) }));
vi.mock("@/lib/stellar/soroswap", () => ({
  readSoroswapQuote: vi.fn(async () => ({
    amountOutStroops: "10562889",
    amountOutMinStroops: "10488833",
    pairAddress: "CCBX3NZTCQLQFSPG7HBOKL4P2RVPOPVFHDNRTOSCCJWBTPL2GHEH7RQS",
    routerAddress: "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD",
  })),
}));

import { GET } from "@/app/api/soroswap/quote/route";
import { AppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { readSoroswapQuote } from "@/lib/stellar/soroswap";

const req = (qs: string) =>
  ({ url: `https://x/api/soroswap/quote?${qs}` }) as unknown as import("next/server").NextRequest;

describe("GET /api/soroswap/quote", () => {
  beforeEach(() => {
    vi.mocked(enforceRateLimit).mockResolvedValue(undefined);
  });

  it("returns the quote as strings, passing the parsed assets and slippage through", async () => {
    const res = await GET(
      req("assetIn=native&assetOut=USDC&amountStroops=100000000&slippageBps=100"),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({
      amountOutStroops: "10562889",
      amountOutMinStroops: "10488833",
      pairAddress: "CCBX3NZTCQLQFSPG7HBOKL4P2RVPOPVFHDNRTOSCCJWBTPL2GHEH7RQS",
      routerAddress: "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD",
    });
    expect(typeof json.data.amountOutStroops).toBe("string");
    expect(vi.mocked(readSoroswapQuote)).toHaveBeenCalledWith(
      expect.objectContaining({
        assetIn: { kind: "native" },
        assetOut: { kind: "known", symbol: "USDC" },
        amountStroops: "100000000",
        slippageBps: 100,
      }),
    );
  });

  it("rejects a malformed query with 422 and field errors", async () => {
    const res = await GET(req("assetIn=native&assetOut=native&amountStroops=abc"));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("VALIDATION");
    expect(Object.keys(json.error.fields)).toEqual(expect.arrayContaining(["amountStroops"]));
  });

  it("is rate limited per user", async () => {
    vi.mocked(enforceRateLimit).mockRejectedValueOnce(
      new AppError("RATE_LIMITED", "Too many quote requests"),
    );
    const res = await GET(req("assetIn=native&assetOut=USDC&amountStroops=1"));
    expect(res.status).toBe(429);
  });
});
