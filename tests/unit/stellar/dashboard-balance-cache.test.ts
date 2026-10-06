import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BalanceDeployment, ReadWorkflowBalances } from "@/lib/stellar/balances";
import { createDashboardBalanceCache } from "@/lib/stellar/dashboard-balance-cache";

const asset = { kind: "native" } as const;
const environment = {
  network: "testnet",
  rpcUrl: "https://example.test",
  relayerAddress: "relayer",
};
const deployment: BalanceDeployment & { ownerId: string; status: string } = {
  id: "d",
  ownerId: "owner",
  status: "CONFIRMED",
  sourceAccount: "wallet",
  contractAddress: "contract",
  graphSnapshot: null,
  pipelineSnapshot: [],
  flow: { templateKind: "PAYER" },
};

function value(amount = "123"): ReadWorkflowBalances {
  const readAt = new Date().toISOString();
  return {
    totals: [{ asset, symbol: "XLM", balanceStroops: amount }],
    nodes: [
      {
        nodeId: "p",
        contractAddress: "contract",
        templateKind: "PAYER",
        asset,
        symbol: "XLM",
        balanceStroops: amount,
      },
    ],
    freshness: {
      status: "fresh",
      totalsComplete: true,
      attemptedAt: readAt,
      cached: false,
      targets: [
        {
          nodeId: "p",
          contractAddress: "contract",
          asset,
          symbol: "XLM",
          balanceStroops: amount,
          readAt,
          stale: false,
        },
      ],
    },
  };
}

function failed(): ReadWorkflowBalances {
  return {
    totals: [],
    nodes: [
      {
        nodeId: "p",
        contractAddress: "contract",
        templateKind: "PAYER",
        asset,
        symbol: "XLM",
        error: "offline",
      },
    ],
    freshness: {
      status: "stale",
      totalsComplete: false,
      attemptedAt: new Date().toISOString(),
      cached: false,
      targets: [
        {
          nodeId: "p",
          contractAddress: "contract",
          asset,
          symbol: "XLM",
          balanceStroops: null,
          readAt: null,
          stale: true,
          error: "offline",
        },
      ],
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T01:00:00Z"));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("shares cold reads, retains actual read time on hits, and reads again at TTL expiry", async () => {
  const gate = deferred<ReadWorkflowBalances>();
  const load = vi
    .fn()
    .mockReturnValueOnce(gate.promise)
    .mockImplementation(async () => value("456"));
  const cache = createDashboardBalanceCache({ load });
  const a = cache.read(deployment, environment);
  const b = cache.read(deployment, environment);
  await Promise.resolve();
  expect(load).toHaveBeenCalledTimes(1);
  gate.resolve(value());
  const first = await a;
  expect(await b).toEqual(first);
  await vi.advanceTimersByTimeAsync(9_999);
  const hit = await cache.read(deployment, environment);
  expect(hit.freshness.cached).toBe(true);
  expect(hit.freshness.targets[0]?.readAt).toBe(first.freshness.targets[0]?.readAt);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect((await cache.read(deployment, environment)).totals[0]?.balanceStroops).toBe("456");
  expect(load).toHaveBeenCalledTimes(2);
});

it("returned values cannot mutate another viewer's cached response", async () => {
  const load = vi.fn(async () => value());
  const cache = createDashboardBalanceCache({ load });
  const first = await cache.read(deployment, environment);
  first.totals[0]!.balanceStroops = "999";
  first.freshness.targets[0]!.stale = true;
  const second = await cache.read(deployment, environment);
  expect(second.totals[0]?.balanceStroops).toBe("123");
  expect(second.freshness.targets[0]?.stale).toBe(false);
});

it("isolates networks, providers, owners, deployments, snapshots, assets and source inputs", async () => {
  const load = vi.fn(async () => value());
  const cache = createDashboardBalanceCache({ load });
  await cache.read(deployment, environment);
  const variants = [
    { ...deployment, id: "other" },
    { ...deployment, ownerId: "other" },
    { ...deployment, pipelineSnapshot: [{ contractAddress: "new" }] },
    { ...deployment, graphSnapshot: { asset: "new" } },
    { ...deployment, contractAddress: "new" },
    { ...deployment, sourceAccount: "other" },
    { ...deployment, flow: { templateKind: "SPLITTER" as const } },
    { ...deployment, status: "FAILED" },
  ];
  for (const variant of variants) await cache.read(variant, environment);
  await cache.read(deployment, { ...environment, network: "mainnet" });
  await cache.read(deployment, { ...environment, rpcUrl: "https://other.test" });
  await cache.read(deployment, { ...environment, relayerAddress: "other" });
  expect(load).toHaveBeenCalledTimes(12);
});

it("invalidates one deployment/network without affecting others", async () => {
  const load = vi.fn(async () => value());
  const cache = createDashboardBalanceCache({ load });
  const mainnet = { ...environment, network: "mainnet" };
  const other = { ...deployment, id: "other" };
  await cache.read(deployment, environment);
  await cache.read(deployment, mainnet);
  await cache.read(other, environment);
  cache.invalidate("testnet", "d");
  expect((await cache.read(deployment, mainnet)).freshness.cached).toBe(true);
  expect((await cache.read(other, environment)).freshness.cached).toBe(true);
  expect((await cache.read(deployment, environment)).freshness.cached).toBe(false);
  expect(load).toHaveBeenCalledTimes(4);
});

it("discards a pre-invalidation read and coalesces all viewers into one follow-up", async () => {
  const old = deferred<ReadWorkflowBalances>();
  const next = deferred<ReadWorkflowBalances>();
  const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const cache = createDashboardBalanceCache({ load });
  const a = cache.read(deployment, environment);
  const b = cache.read(deployment, environment);
  await Promise.resolve();
  cache.invalidate("testnet", "d");
  cache.invalidate("testnet", "d");
  const c = cache.read(deployment, environment);
  old.resolve(value("1"));
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(2);
  next.resolve(value("2"));
  const results = await Promise.all([a, b, c]);
  expect(results.map((r) => r.totals[0]?.balanceStroops)).toEqual(["2", "2", "2"]);
  expect(results.every((r) => r.freshness.status === "fresh")).toBe(true);
  expect((await cache.read(deployment, environment)).totals[0]?.balanceStroops).toBe("2");
  expect(load).toHaveBeenCalledTimes(2);
});

it("repeated invalidation bounds each request to one follow-up and never caches the obsolete result", async () => {
  const old = deferred<ReadWorkflowBalances>();
  const next = deferred<ReadWorkflowBalances>();
  const load = vi
    .fn()
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(next.promise)
    .mockImplementation(async () => value("3"));
  const cache = createDashboardBalanceCache({ load });
  const read = cache.read(deployment, environment);
  await Promise.resolve();
  cache.invalidate("testnet", "d");
  old.resolve(value("1"));
  await vi.advanceTimersByTimeAsync(0);
  cache.invalidate("testnet", "d");
  next.resolve(value("2"));
  const obsolete = await read;
  expect(obsolete.freshness.status).toBe("stale");
  expect(obsolete.freshness.totalsComplete).toBe(false);
  expect(load).toHaveBeenCalledTimes(2);
  expect((await cache.read(deployment, environment)).totals[0]?.balanceStroops).toBe("3");
});

it("shares a follow-up even when the invalidated read fails", async () => {
  const old = deferred<ReadWorkflowBalances>();
  const load = vi
    .fn()
    .mockReturnValueOnce(old.promise)
    .mockImplementation(async () => value("2"));
  const cache = createDashboardBalanceCache({ load });
  const a = cache.read(deployment, environment);
  await Promise.resolve();
  cache.invalidate("testnet", "d");
  const b = cache.read(deployment, environment);
  old.reject(new Error("offline"));
  const results = await Promise.all([a, b]);
  expect(results.map((r) => r.totals[0]?.balanceStroops)).toEqual(["2", "2"]);
  expect(load).toHaveBeenCalledTimes(2);
});

it("a partial refresh exposes failed-target history separately from successful totals", async () => {
  const load = vi.fn(async () => value("123"));
  const cache = createDashboardBalanceCache({ load });
  const original = await cache.read(deployment, environment);
  await vi.advanceTimersByTimeAsync(10_000);
  const partial = value("456");
  partial.nodes[0]!.nodeId = "q";
  partial.freshness.targets[0]!.nodeId = "q";
  partial.nodes.push(...failed().nodes);
  partial.freshness.targets.push(...failed().freshness.targets);
  partial.freshness.status = "partial";
  partial.freshness.totalsComplete = false;
  load.mockResolvedValueOnce(partial);
  const result = await cache.read(deployment, environment);
  expect(result.totals[0]?.balanceStroops).toBe("456");
  expect(result.freshness).toMatchObject({ status: "partial", totalsComplete: false });
  expect(result.freshness.targets[1]).toMatchObject({
    balanceStroops: "123",
    readAt: original.freshness.targets[0]?.readAt,
    stale: true,
    error: "offline",
  });
});

it("preserves last-known zero values and read times on failure without manufacturing complete totals", async () => {
  const load = vi.fn(async () => value("0"));
  const cache = createDashboardBalanceCache({ load });
  const first = await cache.read(deployment, environment);
  await vi.advanceTimersByTimeAsync(10_000);
  load.mockImplementation(async () => failed());
  const stale = await cache.read(deployment, environment);
  expect(stale.totals).toEqual([]);
  expect(stale.freshness).toMatchObject({ status: "stale", totalsComplete: false });
  expect(stale.freshness.targets[0]).toMatchObject({
    stale: true,
    error: "offline",
    balanceStroops: "0",
    readAt: first.freshness.targets[0]?.readAt,
  });
  expect(stale.nodes[0]).toHaveProperty("error", "offline");
  expect(stale.nodes[0]).not.toHaveProperty("balanceStroops");
});

it("does not invent last-known values on a first failure", async () => {
  const cache = createDashboardBalanceCache({ load: async () => failed() });
  expect((await cache.read(deployment, environment)).freshness.targets[0]).toMatchObject({
    balanceStroops: null,
    readAt: null,
    stale: true,
  });
});

it("ages out last-known values even during repeated failed refreshes", async () => {
  const load = vi.fn(async () => value());
  const cache = createDashboardBalanceCache({ load, ttlMs: 10, retentionMs: 100 });
  await cache.read(deployment, environment);
  load.mockImplementation(async () => failed());
  for (let i = 0; i < 10; i++) {
    await vi.advanceTimersByTimeAsync(10);
    await cache.read(deployment, environment);
  }
  expect((await cache.read(deployment, environment)).freshness.targets[0]).toMatchObject({
    balanceStroops: null,
    readAt: null,
  });
});

it("cleans up a rejected refresh so the next request can retry", async () => {
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementation(async () => value());
  const cache = createDashboardBalanceCache({ load });
  await expect(cache.read(deployment, environment)).rejects.toThrow("offline");
  expect((await cache.read(deployment, environment)).freshness.status).toBe("fresh");
  expect(load).toHaveBeenCalledTimes(2);
});

it("times out an abandoned refresh, frees its slot, and discards late completion", async () => {
  const abandoned = deferred<ReadWorkflowBalances>();
  const load = vi
    .fn()
    .mockReturnValueOnce(abandoned.promise)
    .mockImplementation(async () => value("2"));
  const cache = createDashboardBalanceCache({ load, refreshTimeoutMs: 100, maxEntries: 1 });
  const pending = expect(cache.read(deployment, environment)).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(100);
  await pending;
  await cache.read({ ...deployment, id: "other" }, environment);
  expect((await cache.read(deployment, environment)).totals[0]?.balanceStroops).toBe("2");
  abandoned.resolve(value("1"));
  await vi.advanceTimersByTimeAsync(0);
  expect((await cache.read(deployment, environment)).totals[0]?.balanceStroops).toBe("2");
});

it("reports a refresh timeout as stale when previous values exist and recovers", async () => {
  const load = vi.fn(async () => value());
  const cache = createDashboardBalanceCache({ load, ttlMs: 10, refreshTimeoutMs: 100 });
  const original = await cache.read(deployment, environment);
  await vi.advanceTimersByTimeAsync(10);
  load.mockImplementationOnce(() => new Promise(() => {}));
  const read = cache.read(deployment, environment);
  await vi.advanceTimersByTimeAsync(100);
  const stale = await read;
  expect(stale.freshness.status).toBe("stale");
  expect(stale.freshness.targets[0]).toMatchObject({
    readAt: original.freshness.targets[0]?.readAt,
    error: "Dashboard balance refresh timed out",
  });
  await vi.advanceTimersByTimeAsync(10);
  expect((await cache.read(deployment, environment)).freshness.status).toBe("fresh");
});

it("bounds retained entries, refuses excess cold identities when all slots are active, and allows joins", async () => {
  const pending = deferred<ReadWorkflowBalances>();
  const load = vi.fn().mockReturnValue(pending.promise);
  const cache = createDashboardBalanceCache({ load, maxEntries: 1 });
  const a = cache.read(deployment, environment);
  const b = cache.read(deployment, environment);
  await expect(cache.read({ ...deployment, id: "other" }, environment)).rejects.toMatchObject({
    code: "RATE_LIMITED",
    retryAfterSeconds: 1,
  });
  pending.resolve(value());
  await Promise.all([a, b]);
  expect(load).toHaveBeenCalledTimes(1);
  await cache.read({ ...deployment, id: "other" }, environment);
  await cache.read(deployment, environment);
  expect(load).toHaveBeenCalledTimes(3);
});

it("expires idle cache entries and associated timers", async () => {
  const load = vi.fn(async () => value());
  const cache = createDashboardBalanceCache({ load, ttlMs: 10, retentionMs: 100 });
  await cache.read(deployment, environment);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(100);
  expect(vi.getTimerCount()).toBe(0);
  await cache.read(deployment, environment);
  expect(load).toHaveBeenCalledTimes(2);
});
