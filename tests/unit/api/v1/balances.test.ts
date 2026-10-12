import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { Address, xdr } from "@stellar/stellar-sdk";

const mocks = vi.hoisted(() => ({
  db: { deploymentApiToken: { findUnique: vi.fn(), update: vi.fn() } },
  entries: vi.fn(),
  balance: vi.fn(),
  service: vi.fn(async () => undefined),
  redis: null as null | { set: ReturnType<typeof vi.fn>; eval: ReturnType<typeof vi.fn> },
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/redis", () => ({ redis: () => mocks.redis }));
vi.mock("@/lib/api/request-history/delivery", () => ({ queueApiRequest: vi.fn() }));
vi.mock("@/lib/deployments/service-work", () => ({ assertDeploymentService: mocks.service }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ getLedgerEntries: mocks.entries }),
}));
vi.mock("@/lib/stellar/balance", () => ({ createTokenBalanceReader: () => mocks.balance }));
import { GET } from "@/app/api/v1/deployments/[id]/balances/route";
import { DeploymentBalancesSchema } from "@/lib/api/v1/schema";
import { BalancePipelineSchema, balanceCandidates } from "@/lib/api/v1/balance-targets";
import {
  createPartnerBalanceCache,
  getPartnerBalances,
  readPartnerBalances,
} from "@/lib/stellar/partner-balances";
import { AppError } from "@/lib/errors";
import { deploymentCapabilities } from "@/lib/api/v1/capabilities";
import {
  ctx,
  DEPLOYMENT_ID,
  newToken,
  tokenRow,
  TRIGGER,
  PAYER,
  OTHER_CONTRACT,
} from "./execute-fixtures";

let token: ReturnType<typeof newToken>;
let sequence = 0;
const pipeline = [{ nodeId: "schedule", templateKind: "STREAMER", contractAddress: TRIGGER }];
function deployment(extra: Record<string, unknown> = {}) {
  return {
    id: DEPLOYMENT_ID,
    status: "CONFIRMED",
    network: "testnet",
    sourceAccount: null,
    pipelineSnapshot: pipeline,
    ...extra,
  } as Parameters<typeof readPartnerBalances>[0];
}
function authorize(extra: Record<string, unknown> = {}) {
  mocks.db.deploymentApiToken.findUnique.mockResolvedValue(
    tokenRow(token, { ...deployment(), ...extra }),
  );
}
function call(authorization = `Bearer ${token.plaintext}`, id = DEPLOYMENT_ID) {
  return GET(
    new Request(`https://paiflow.test/api/v1/deployments/${id}/balances`, {
      headers: { authorization },
    }) as NextRequest,
    ctx(id),
  );
}
function instance(key: xdr.LedgerKey, fields: Record<string, string> = { Asset: OTHER_CONTRACT }) {
  return {
    latestLedger: 100,
    entries: [
      {
        key,
        val: {
          contractData: () => ({
            val: () => ({
              instance: () => ({
                storage: () =>
                  Object.entries(fields).map(
                    ([name, address]) =>
                      new xdr.ScMapEntry({
                        key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]),
                        val: new Address(address).toScVal(),
                      }),
                  ),
              }),
            }),
          }),
        },
      },
    ],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.redis = null;
  token = newToken();
  // Cache identity differs per test; production uses the immutable deployment UUID.
  sequence++;
  mocks.db.deploymentApiToken.update.mockResolvedValue({});
  mocks.service.mockResolvedValue(undefined);
  mocks.entries.mockImplementation(async (key) => instance(key));
  mocks.balance.mockResolvedValue(900719925474099312345n);
  authorize({ pipelineSnapshot: [{ ...pipeline[0], nodeId: `schedule-${sequence}` }] });
});

describe("deployment-token balances", () => {
  it("reads contract balances without a session, preserves integer strings and excludes private data", async () => {
    authorize({
      pipelineSnapshot: [{ ...pipeline[0], nodeId: `private-${sequence}` }],
      webhookSecret: "must-not-leak",
      graphSnapshot: { privateEmail: "private@example.test" },
    });
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    const parsed = DeploymentBalancesSchema.parse(body.data);
    expect(parsed.nodes[0]).toMatchObject({
      tokenContract: OTHER_CONTRACT,
      balanceStroops: "900719925474099312345",
      stale: false,
    });
    expect(parsed.freshness.totalsComplete).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/must-not-leak|private@example|sourceAccount|ownerId/);
    expect(mocks.balance).toHaveBeenCalledWith({
      tokenAddress: OTHER_CONTRACT,
      holderAddress: TRIGGER,
    });
  });
  it.each(["", "Bearer pkdev_bad", "Bearer pfk_bad"])(
    "rejects invalid token %s before RPC",
    async (auth) => {
      expect((await call(auth)).status).toBe(401);
      expect(mocks.entries).not.toHaveBeenCalled();
    },
  );
  it.each(["revoked", "wrong-deployment", "retiring", "retired", "expired"])(
    "rejects %s tokens",
    async (reason) => {
      const row = tokenRow(token, deployment());
      if (reason === "revoked") row.revokedAt = new Date() as never;
      if (reason === "expired") row.expiresAt = new Date(0) as never;
      if (reason === "wrong-deployment") row.deploymentId = "22222222-2222-2222-2222-222222222222";
      if (reason === "retired" || reason === "retiring")
        row.deployment.serviceState = reason.toUpperCase();
      mocks.db.deploymentApiToken.findUnique.mockResolvedValue(row);
      expect((await call()).status).toBe(401);
      expect(mocks.entries).not.toHaveBeenCalled();
    },
  );
  it("refuses a service retirement after authentication before live balance reads", async () => {
    mocks.service.mockRejectedValue(new AppError("NOT_FOUND", "Deployment service has ended"));
    expect((await call()).status).toBe(404);
    expect(mocks.entries).not.toHaveBeenCalled();
  });
  it.each([
    { network: "mainnet" },
    { status: "PREPARING" },
    { pipelineSnapshot: [{ ...pipeline[0], templateKind: "MULTISIG" }] },
    { pipelineSnapshot: null },
    { pipelineSnapshot: [{ ...pipeline[0], contractAddress: "invalid" }] },
  ])("refuses unsupported deployment %j", async (extra) => {
    authorize(extra);
    expect([404, 422]).toContain((await call()).status);
    expect(mocks.entries).not.toHaveBeenCalled();
  });
  it("enforces per-token route polling limit", async () => {
    for (let n = 0; n < 30; n++) expect((await call()).status).toBe(200);
    const response = await call();
    expect(response.status).toBe(429);
    expect(mocks.entries).toHaveBeenCalledTimes(1);
  });
});

describe("live targets and display freshness", () => {
  it("reads each node's current asset and both Swap assets, never graph metadata", async () => {
    mocks.entries.mockImplementation(async (key) =>
      instance(
        key,
        new Address(TRIGGER).toScAddress().toXDR().equals(key.contractData().contract().toXDR())
          ? { AssetIn: OTHER_CONTRACT, AssetOut: PAYER }
          : { Asset: PAYER },
      ),
    );
    const result = await readPartnerBalances(
      deployment({
        pipelineSnapshot: [
          { ...pipeline[0], templateKind: "SWAPPER" },
          { nodeId: "pay", templateKind: "PAYER", contractAddress: PAYER },
        ],
      }),
    );
    expect(result.nodes).toHaveLength(3);
    expect(result.totals).toEqual(
      expect.arrayContaining([
        { tokenContract: OTHER_CONTRACT, balanceStroops: "900719925474099312345" },
        { tokenContract: PAYER, balanceStroops: "1801439850948198624690" },
      ]),
    );
  });
  it("does not turn missing instances or unavailable asset fields into zero", async () => {
    mocks.entries.mockResolvedValue({ latestLedger: 100, entries: [] });
    const result = await readPartnerBalances(deployment());
    expect(result.totals).toEqual([]);
    expect(result.freshness).toMatchObject({ status: "stale", totalsComplete: false });
    expect(result.nodes[0]).toMatchObject({ balanceStroops: null, readAt: null, stale: true });
    expect(mocks.balance).not.toHaveBeenCalled();
  });
  it("limits live instance work to four concurrent workers", async () => {
    const { StrKey } = await import("@stellar/stellar-sdk");
    let active = 0;
    let peak = 0;
    mocks.entries.mockImplementation(async (key) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return instance(key);
    });
    const nodes = Array.from({ length: 12 }, (_, i) => ({
      ...pipeline[0],
      nodeId: `${i}`,
      contractAddress: StrKey.encodeContract(Buffer.alloc(32, i + 10)),
    }));
    const result = await readPartnerBalances(deployment({ pipelineSnapshot: nodes }));
    expect(peak).toBe(4);
    expect(result.nodes).toHaveLength(12);
  });
  it("shows a genuine zero only after successful asset and token reads", async () => {
    mocks.balance.mockResolvedValue(0n);
    const result = await readPartnerBalances(deployment());
    expect(result.nodes[0]).toMatchObject({
      balanceStroops: "0",
      stale: false,
      readAt: expect.any(String),
    });
    expect(result.freshness.totalsComplete).toBe(true);
  });
  it("refuses malformed current asset fields without falling back to graph assets", async () => {
    mocks.entries.mockImplementation(async (key) => instance(key, { Unexpected: OTHER_CONTRACT }));
    const result = await readPartnerBalances(deployment());
    expect(result.nodes[0]).toMatchObject({
      tokenContract: null,
      balanceStroops: null,
      stale: true,
    });
    expect(result.freshness.totalsComplete).toBe(false);
    expect(mocks.balance).not.toHaveBeenCalled();
  });
  it("returns partial totals for per-node failed reads and sanitizes provider errors", async () => {
    mocks.balance.mockImplementation(async ({ holderAddress }) => {
      if (holderAddress === PAYER) throw new Error("https://provider.test/private-secret");
      return 5n;
    });
    const result = await readPartnerBalances(
      deployment({
        pipelineSnapshot: [
          pipeline[0],
          { nodeId: "pay", templateKind: "PAYER", contractAddress: PAYER },
        ],
      }),
    );
    expect(result.freshness).toMatchObject({ status: "partial", totalsComplete: false });
    expect(result.totals).toEqual([{ tokenContract: OTHER_CONTRACT, balanceStroops: "5" }]);
    expect(result.nodes.find((n) => n.nodeId === "pay")).toMatchObject({
      balanceStroops: null,
      stale: true,
    });
    expect(JSON.stringify(result)).not.toContain("private-secret");
  });
  it("marks unsupported multisig targets incomplete alongside supported reads", async () => {
    const result = await readPartnerBalances(
      deployment({
        pipelineSnapshot: [
          pipeline[0],
          { nodeId: "multisig", templateKind: "MULTISIG", contractAddress: PAYER },
        ],
      }),
    );
    expect(result.freshness.totalsComplete).toBe(false);
    expect(result.nodes.find((n) => n.nodeId === "multisig")?.balanceStroops).toBeNull();
    expect(mocks.entries).toHaveBeenCalledTimes(1);
  });
  it("rejects ambiguous or excessive pipelines before live reads", async () => {
    expect(BalancePipelineSchema.safeParse([pipeline[0], pipeline[0]]).success).toBe(false);
    const tooMany = Array.from({ length: 65 }, (_, i) => ({
      ...pipeline[0],
      nodeId: `${i}`,
      contractAddress: TRIGGER,
    }));
    // 65 otherwise supported entries exceed the per-refresh contract bound.
    const { StrKey } = await import("@stellar/stellar-sdk");
    const nodes = tooMany.map((n, i) => ({
      ...n,
      contractAddress: StrKey.encodeContract(Buffer.alloc(32, i)),
    }));
    expect(balanceCandidates(nodes, true)).toEqual([]);
    await expect(getPartnerBalances(deployment({ pipelineSnapshot: nodes }))).rejects.toMatchObject(
      { code: "VALIDATION" },
    );
  });
  it("never publishes a successful read after the deadline as fresh", async () => {
    const controller = new AbortController();
    mocks.balance.mockImplementation(async () => {
      controller.abort();
      return 1n;
    });
    const result = await readPartnerBalances(deployment(), controller.signal);
    expect(result.freshness).toMatchObject({ status: "stale", totalsComplete: false });
    expect(result.totals).toEqual([]);
  });
  it("single-flights refreshes, reports cached timestamps, and does not retain failures as fresh", async () => {
    const load = vi.fn(readPartnerBalances);
    const cache = createPartnerBalanceCache(load, 10);
    const [a, b] = await Promise.all([cache(deployment()), cache(deployment())]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    const cached = await cache(deployment());
    expect(cached.freshness.cached).toBe(true);
    expect(cached.nodes[0]?.readAt).toBe(a.nodes[0]?.readAt);
    await new Promise((resolve) => setTimeout(resolve, 15));
    mocks.balance.mockRejectedValue(new Error("unavailable"));
    const failed = await cache(deployment());
    expect(failed.freshness.totalsComplete).toBe(false);
    expect(failed.nodes[0]?.balanceStroops).toBeNull();
  });
  it("shares a refresh lease across replicas and refuses another replica before RPC", async () => {
    mocks.redis = { set: vi.fn().mockResolvedValue(null), eval: vi.fn() };
    const cache = createPartnerBalanceCache();
    await expect(cache(deployment())).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(mocks.entries).not.toHaveBeenCalled();
    expect(mocks.redis.set).toHaveBeenCalledWith(
      expect.stringContaining(DEPLOYMENT_ID),
      expect.any(String),
      "PX",
      60000,
      "NX",
    );
  });
  it("fails closed when distributed refresh coordination is unavailable", async () => {
    mocks.redis = { set: vi.fn().mockRejectedValue(new Error("down")), eval: vi.fn() };
    await expect(createPartnerBalanceCache()(deployment())).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(mocks.entries).not.toHaveBeenCalled();
  });
  it("shortens only its own lease after actual read settlement, preserving a replacement lease", async () => {
    mocks.redis = { set: vi.fn().mockResolvedValue("OK"), eval: vi.fn().mockResolvedValue(0) };
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.balance.mockImplementation(async () => {
      await blocked;
      return 1n;
    });
    const pending = createPartnerBalanceCache()(deployment());
    await vi.waitFor(() => expect(mocks.balance).toHaveBeenCalled());
    expect(mocks.redis.eval).not.toHaveBeenCalled();
    release!();
    await pending;
    const claimToken = mocks.redis.set.mock.calls[0]![1];
    expect(mocks.redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("== ARGV[1]"),
      1,
      expect.stringContaining(DEPLOYMENT_ID),
      claimToken,
      "10000",
    );
    // Lua returns 0 if a lease expired/replaced: no unconditional release or overwrite.
    expect(mocks.redis.set).toHaveBeenCalledTimes(1);
  });
  it("keeps separate cache identities when the deployed pipeline changes", async () => {
    const load = vi.fn(readPartnerBalances);
    const cache = createPartnerBalanceCache(load);
    await cache(deployment());
    await cache(deployment({ pipelineSnapshot: [{ ...pipeline[0], contractAddress: PAYER }] }));
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("discovers candidates without RPC and disables mutable reads when Dev is off", () => {
    const cap = deploymentCapabilities({
      ...deployment(),
      graphSnapshot: null,
      webhookSecret: null,
    } as Parameters<typeof deploymentCapabilities>[0]);
    expect(cap.operations.balances.status).toBe("conditional");
    expect(cap.operations.balances.nodeIds).toEqual(["schedule"]);
    expect(mocks.entries).not.toHaveBeenCalled();
    expect(balanceCandidates([{ ...pipeline[0], templateKind: "PAYER_DEV" }], false)).toEqual([]);
  });
});

it("validates realistic and adversarial balance responses", async () => {
  const result = await readPartnerBalances(deployment());
  expect(DeploymentBalancesSchema.safeParse(result).success).toBe(true);
  for (const amount of [1, "-1", "1.2", "NaN", (1n << 127n).toString(), "9".repeat(40)]) {
    expect(
      DeploymentBalancesSchema.safeParse({
        ...result,
        nodes: [{ ...result.nodes[0], balanceStroops: amount }],
      }).success,
    ).toBe(false);
  }
  expect(DeploymentBalancesSchema.safeParse({ ...result, ownerId: "private" }).success).toBe(false);
});
