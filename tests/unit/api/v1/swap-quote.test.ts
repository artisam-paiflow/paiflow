import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  db: { deploymentApiToken: { findUnique: vi.fn(), update: vi.fn() } },
  getter: vi.fn(),
  quote: vi.fn(),
  service: vi.fn(),
  budget: vi.fn(),
  production: false,
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/deployments/service-work", () => ({ assertDeploymentService: mocks.service }));
vi.mock("@/lib/stellar/contract-read", () => ({ simulateGetter: mocks.getter }));
vi.mock("@/lib/stellar/soroswap", () => ({ readSoroswapContractQuote: mocks.quote }));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  rateLimit: mocks.budget,
}));
vi.mock("@/lib/env", async (original) => {
  const module = await original<typeof import("@/lib/env")>();
  return {
    ...module,
    env: () => ({ ...module.env(), NODE_ENV: mocks.production ? "production" : "test" }),
    soroswapRouterAddress: () => "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD",
  };
});
import { GET } from "@/app/api/v1/deployments/[id]/swap-quote/route";
import { SwapQuoteQuerySchema, SwapQuoteSchema } from "@/lib/api/v1/swap-quote-schema";
import { AppError } from "@/lib/errors";
import { ctx, DEPLOYMENT_ID, newToken, tokenRow, TRIGGER, PAYER } from "./execute-fixtures";
const ROUTER = "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD";
let token: ReturnType<typeof newToken>;
let deployment: Record<string, unknown>;
const swap = { nodeId: "swap", templateKind: "SWAPPER", contractAddress: TRIGGER };
function authorize(extra: Record<string, unknown> = {}) {
  deployment = {
    id: DEPLOYMENT_ID,
    network: "testnet",
    status: "CONFIRMED",
    serviceState: "ACTIVE",
    pipelineSnapshot: [swap],
    ...extra,
  };
  mocks.db.deploymentApiToken.findUnique.mockResolvedValue(tokenRow(token, deployment));
}
function call(query = "amountStroops=100", authorization = `Bearer ${token.plaintext}`) {
  return GET(
    new Request(`https://paiflow.test/api/v1/deployments/${DEPLOYMENT_ID}/swap-quote?${query}`, {
      headers: { authorization },
    }) as NextRequest,
    ctx(),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.production = false;
  token = newToken();
  authorize();
  mocks.db.deploymentApiToken.update.mockResolvedValue({});
  mocks.service.mockResolvedValue(undefined);
  mocks.budget.mockResolvedValue({
    ok: true,
    shared: true,
    count: 1,
    remaining: 19,
    resetAt: Date.now() + 60_000,
  });
  mocks.getter.mockImplementation(
    async (_address, name) =>
      ({
        asset_in: TRIGGER,
        asset_out: PAYER,
        router: ROUTER,
        slippage_bps: 100,
      })[name as string],
  );
  mocks.quote.mockResolvedValue({
    amountOutStroops: "200",
    amountOutMinStroops: "190",
    routerAddress: ROUTER,
    pairAddress: PAYER,
  });
});
describe("deployment-scoped Swap quotes", () => {
  it("reads deployed configuration without a session or mutable graph", async () => {
    authorize({ graphSnapshot: { edited: true } });
    const response = await call();
    expect(response.status).toBe(200);
    const data = SwapQuoteSchema.parse((await response.json()).data);
    expect(data).toMatchObject({
      nodeId: "swap",
      amountInStroops: "100",
      amountOutStroops: "200",
      assetInContractAddress: TRIGGER,
      assetOutContractAddress: PAYER,
      slippageBps: 100,
      freshness: "live",
      estimate: true,
      scope: "selected_node",
      meetsMinimumAtQuote: true,
    });
    expect(Date.parse(data.readStartedAt)).toBeLessThanOrEqual(Date.parse(data.quotedAt));
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.quote).toHaveBeenCalledWith(
      {
        inId: TRIGGER,
        outId: PAYER,
        routerAddress: ROUTER,
        amountStroops: "100",
        slippageBps: 100,
      },
      expect.objectContaining({ requestId: expect.any(String) }),
    );
    expect(mocks.budget).toHaveBeenCalledWith(`v1:swap-quote-rpc:testnet:${DEPLOYMENT_ID}`, 20, 60);
  });
  it("labels a quote below the contract's current minimum", async () => {
    mocks.quote.mockResolvedValue({
      amountOutStroops: "189",
      amountOutMinStroops: "190",
      routerAddress: ROUTER,
      pairAddress: PAYER,
    });
    expect((await (await call()).json()).data.meetsMinimumAtQuote).toBe(false);
  });
  it("requires nodeId for multiple deployed Swaps", async () => {
    authorize({ pipelineSnapshot: [swap, { ...swap, nodeId: "other", contractAddress: PAYER }] });
    expect((await call()).status).toBe(422);
    expect(mocks.getter).not.toHaveBeenCalled();
    expect((await call("amountStroops=100&nodeId=other")).status).toBe(200);
    expect(mocks.getter).toHaveBeenCalledWith(PAYER, "asset_in", expect.any(Object));
  });
  it.each([
    null,
    [{ ...swap, templateKind: "PAYER" }],
    [{ ...swap, contractAddress: "bad" }],
    [swap, swap],
  ])("rejects malformed/unsupported pipeline %j before RPC", async (pipelineSnapshot) => {
    authorize({ pipelineSnapshot });
    expect((await call()).status).toBe(422);
    expect(mocks.getter).not.toHaveBeenCalled();
  });
  it("rejects unknown node and wrong network", async () => {
    expect((await call("amountStroops=100&nodeId=missing")).status).toBe(422);
    authorize({ network: "mainnet" });
    expect((await call()).status).toBe(422);
    expect(mocks.getter).not.toHaveBeenCalled();
  });
  it.each([
    "",
    "amountStroops=0",
    "amountStroops=-1",
    "amountStroops=1.2",
    `amountStroops=${1n << 127n}`,
    "amountStroops=100&assetIn=native",
    "amountStroops=100&router=custom",
    "amountStroops=100&slippageBps=200",
    "amountStroops=100&nodeId=",
  ])("rejects invalid or caller-selected configuration %s", async (query) => {
    expect((await call(query)).status).toBe(422);
    expect(mocks.getter).not.toHaveBeenCalled();
  });
  it.each(["asset_in", "asset_out", "router", "slippage_bps"])(
    "propagates %s getter RPC failures",
    async (field) => {
      mocks.getter.mockImplementation(async (_address, name) => {
        if (name === field) throw new AppError("UPSTREAM_RPC", "RPC unavailable");
        return { asset_in: TRIGGER, asset_out: PAYER, router: ROUTER, slippage_bps: 100 }[
          name as string
        ];
      });
      expect((await call()).status).toBe(502);
      expect(mocks.quote).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["asset_in", "bad"],
    ["asset_out", TRIGGER],
    ["router", PAYER],
    ["slippage_bps", 10001],
    ["slippage_bps", 10n],
  ])("refuses wrong or malformed deployed %s", async (field, value) => {
    mocks.getter.mockImplementation(async (_address, name) =>
      name === field
        ? value
        : { asset_in: TRIGGER, asset_out: PAYER, router: ROUTER, slippage_bps: 100 }[
            name as string
          ],
    );
    expect([422, 502]).toContain((await call()).status);
    expect(mocks.quote).not.toHaveBeenCalled();
  });
  it("propagates pool RPC errors", async () => {
    mocks.quote.mockRejectedValue(new AppError("UPSTREAM_RPC", "RPC unavailable"));
    expect((await call()).status).toBe(502);
  });
  it.each(["invalid", "revoked", "wrong-deployment", "RETIRING", "RETIRED"])(
    "rejects %s auth/service",
    async (bad) => {
      const row = tokenRow(token, deployment);
      if (bad === "revoked") row.revokedAt = new Date() as never;
      if (bad === "wrong-deployment") row.deploymentId = "22222222-2222-4222-8222-222222222222";
      if (bad === "RETIRING" || bad === "RETIRED") row.deployment.serviceState = bad;
      mocks.db.deploymentApiToken.findUnique.mockResolvedValue(row);
      expect((await call(undefined, bad === "invalid" ? "Bearer invalid" : undefined)).status).toBe(
        401,
      );
      expect(mocks.getter).not.toHaveBeenCalled();
    },
  );
  it("refuses retirement after authentication", async () => {
    mocks.service.mockRejectedValue(new AppError("NOT_FOUND", "Deployment not found"));
    expect((await call()).status).toBe(404);
    expect(mocks.getter).not.toHaveBeenCalled();
  });

  it("enforces the per-token limit before any additional RPC work", async () => {
    for (let n = 0; n < 20; n++) expect((await call()).status).toBe(200);
    const reads = mocks.getter.mock.calls.length;
    expect((await call()).status).toBe(429);
    expect(mocks.getter).toHaveBeenCalledTimes(reads);
  });
  it("bounds shared RPC work before reads", async () => {
    mocks.budget.mockResolvedValue({ ok: false, shared: true, resetAt: Date.now() + 60_000 });
    expect((await call()).status).toBe(429);
    expect(mocks.getter).not.toHaveBeenCalled();
  });
  it("fails closed when production cannot share the RPC budget", async () => {
    mocks.production = true;
    mocks.budget.mockResolvedValue({ ok: true, shared: false });
    expect((await call()).status).toBe(502);
    expect(mocks.getter).not.toHaveBeenCalled();
  });
});
describe("Swap quote schemas", () => {
  it.each([
    { amountOutStroops: "0" },
    { amountOutMinStroops: "-1" },
    { amountOutMinStroops: "1.2" },
    { amountOutMinStroops: "x" },
    { amountOutMinStroops: "9".repeat(1000) },
    { amountOutMinStroops: (1n << 127n).toString() },
    { slippageBps: 10001 },
    { freshness: "cached" },
    { estimate: false },
    { scope: "entire_flow" },
    { readStartedAt: "not-a-date" },
    { assetInContractAddress: "invalid" },
    { secret: "unexpected configuration" },
  ])("rejects malformed response fields %j", async (invalid) => {
    const response = await call();
    const data = (await response.json()).data;
    expect(SwapQuoteSchema.safeParse({ ...data, ...invalid }).success).toBe(false);
  });

  it.each(["1", "9007199254740993", ((1n << 127n) - 1n).toString()])(
    "keeps amount %s exact",
    (amountStroops) => {
      expect(SwapQuoteQuerySchema.parse({ amountStroops }).amountStroops).toBe(amountStroops);
    },
  );
  it.each(["1e3", "9".repeat(1000), "NaN", "1.0"])(
    "rejects malformed amounts %s",
    (amountStroops) => {
      expect(SwapQuoteQuerySchema.safeParse({ amountStroops }).success).toBe(false);
    },
  );
});
