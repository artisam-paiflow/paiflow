import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Address, Keypair, Networks, SorobanDataBuilder, xdr } from "@stellar/stellar-sdk";
import { TemplateKind } from "@prisma/client";
import type { RelayerChannel } from "@/lib/stellar/relayer-channels";

const { mockDb, mockRpc, withChannel, clock, reserveFee } = vi.hoisted(() => ({
  reserveFee: vi.fn(),
  mockDb: {
    auditLog: { create: vi.fn() },
    deployment: { findMany: vi.fn(), update: vi.fn() },
    contractTemplate: { findMany: vi.fn() },
    factoryDeployment: { findUnique: vi.fn() },
    ttlMaintenanceState: { upsert: vi.fn(), update: vi.fn() },
  },
  mockRpc: {
    getLedgerEntries: vi.fn(),
    getLatestLedger: vi.fn(),
    getAccount: vi.fn(),
    simulateTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    getTransaction: vi.fn(),
  },
  withChannel: vi.fn(),
  clock: { expired: false },
}));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn() } }));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => mockRpc }));
vi.mock("@/lib/stellar/relayer-channels", () => ({ withRelayerChannel: withChannel }));
vi.mock("@/lib/stellar/ttl-deadline", async (original) => {
  const actual = await original<typeof import("@/lib/stellar/ttl-deadline")>();
  return {
    ...actual,
    ttlDeadline: (ms: number) => {
      const deadline = actual.ttlDeadline(ms);
      return { ...deadline, expired: () => clock.expired || deadline.expired() };
    },
  };
});
vi.mock("@/lib/stellar/fee-budget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stellar/fee-budget")>()),
  reserveTransactionFee: reserveFee,
}));

const contract = (byte: number) => Address.contract(Buffer.alloc(32, byte)).toString();
const HASH = "ab".repeat(32);
const OLD_HASH = "cd".repeat(32);
const settings = xdr.LedgerEntryData.configSetting(
  xdr.ConfigSettingEntry.configSettingStateArchival(
    new xdr.StateArchivalSettings({
      maxEntryTtl: 600_000,
      minTemporaryTtl: 1,
      minPersistentTtl: 100,
      persistentRentRateDenominator: xdr.Int64.fromString("1"),
      tempRentRateDenominator: xdr.Int64.fromString("1"),
      maxEntriesToArchive: 1,
      liveSorobanStateSizeWindowSampleSize: 1,
      liveSorobanStateSizeWindowSamplePeriod: 1,
      evictionScanSize: 1,
      startingEvictionScanLevel: 1,
    }),
  ),
);
function instanceVal(address: string, hash = OLD_HASH) {
  return xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: new xdr.ExtensionPoint(0),
      contract: new Address(address).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
      val: xdr.ScVal.scvContractInstance(
        new xdr.ScContractInstance({
          executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.from(hash, "hex")),
          storage: null,
        }),
      ),
    }),
  );
}
const entries = new Map<string, { val: xdr.LedgerEntryData; liveUntilLedgerSeq?: number }>();
async function load() {
  vi.resetModules();
  // Recreate the partial mock so its real config helper sees the fresh env()
  // module; a cached importOriginal would retain an earlier test's env memo.
  const actual = await vi.importActual<typeof import("@/lib/stellar/fee-budget")>(
    "@/lib/stellar/fee-budget",
  );
  vi.doMock("@/lib/stellar/fee-budget", () => ({ ...actual, reserveTransactionFee: reserveFee }));
  return import("@/lib/stellar/ttl-maintenance");
}
beforeEach(() => {
  vi.clearAllMocks();
  entries.clear();
  clock.expired = false;
  reserveFee.mockResolvedValue(undefined);
  mockDb.contractTemplate.findMany.mockResolvedValue([]);
  mockDb.factoryDeployment.findUnique.mockResolvedValue(null);
  mockDb.deployment.findMany.mockResolvedValue([]);
  mockDb.deployment.update.mockResolvedValue({});
  mockDb.ttlMaintenanceState.upsert.mockResolvedValue({ sharedOffset: 0, sharedFirst: true });
  mockDb.ttlMaintenanceState.update.mockResolvedValue({});
  mockRpc.getLatestLedger.mockResolvedValue({ sequence: 100 });
  mockRpc.getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => ({
    latestLedger: 100,
    entries: keys.flatMap((key) => {
      if (key.switch().name === "configSetting") return [{ key, val: settings }];
      const entry = entries.get(key.toXDR("base64"));
      return entry ? [{ key, ...entry }] : [];
    }),
  }));
});
afterEach(() => {
  delete process.env.STELLAR_TTL_MAINTENANCE_ENABLED;
  delete process.env.STELLAR_TTL_MAX_FEE_STROOPS;
  delete process.env.STELLAR_TTL_FEE_BUDGET_NAME;
  delete process.env.STELLAR_TTL_FEE_BUDGET_STROOPS;
  vi.useRealTimers();
});

describe("TTL inventory", () => {
  it("validates complete snapshots, deduplicates, and uses legacy address only for null snapshot", async () => {
    const mod = await load();
    expect(
      mod.ttlSnapshotAddresses(
        [{ contractAddress: contract(1) }, { contractAddress: contract(1) }],
        contract(2),
      ),
    ).toEqual([contract(1)]);
    expect(mod.ttlSnapshotAddresses(null, contract(2))).toEqual([contract(2)]);
    expect(() =>
      mod.ttlSnapshotAddresses(
        [{ contractAddress: contract(1) }, { contractAddress: "bad" }],
        contract(2),
      ),
    ).toThrow();
    expect(() => mod.ttlSnapshotAddresses({}, contract(2))).toThrow();
    expect(() =>
      mod.ttlSnapshotAddresses(Array(841).fill({ contractAddress: contract(1) }), null),
    ).toThrow();
  });
  it("handles threshold boundaries independently and preserves unknown missing state", async () => {
    const { ttlStatus } = await load();
    expect(ttlStatus(50_101, 100, 50_000)).toBe("healthy");
    expect(ttlStatus(50_100, 100, 50_000)).toBe("due");
    expect(ttlStatus(50_099, 100, 50_000)).toBe("due");
    expect(ttlStatus(undefined, 100, 50_000)).toBe("missing");
  });
  it("defaults to no chain writes; discovers historical code from instance executable and rotates durable targets", async () => {
    const mod = await load();
    const addr = contract(1);
    mockDb.deployment.findMany.mockResolvedValue([
      {
        id: "dep",
        pipelineSnapshot: [{ contractAddress: addr }, { contractAddress: contract(2) }],
        contractAddress: null,
        ttlScanOffset: 0,
      },
    ]);
    mockDb.contractTemplate.findMany.mockResolvedValue([{ kind: "SUBSCRIPTION", wasmHash: HASH }]);
    entries.set(mod.ttlInstanceKey(addr).toXDR("base64"), {
      val: instanceVal(addr),
      liveUntilLedgerSeq: 600_000,
    });
    const result = await mod.runTtlMaintenance();
    expect(result.dryRun).toBe(true);
    expect(withChannel).not.toHaveBeenCalled();
    expect(mockRpc.simulateTransaction).not.toHaveBeenCalled();
    expect(result.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: addr, status: "healthy" }),
        expect.objectContaining({ target: OLD_HASH, kind: "code", status: "missing" }),
      ]),
    );
    expect(result.scans).toEqual([{ deploymentId: "dep", totalTargets: 2, nextOffset: 0 }]);
    expect(mockDb.deployment.update).toHaveBeenCalledWith({
      where: { id: "dep" },
      data: { ttlCheckedAt: expect.any(Date), ttlScanOffset: 0 },
    });
    expect(mockDb.deployment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { network: "testnet", status: "CONFIRMED", owner: { role: { not: "SANDBOX" } } },
        orderBy: [{ ttlCheckedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
      }),
    );
  });
  it("failed inventory advances the target cursor and timestamps attempt, so first bad targets cannot starve later keys", async () => {
    const mod = await load();
    mockDb.deployment.findMany.mockResolvedValue([
      {
        id: "dep",
        pipelineSnapshot: [1, 2].map((n) => ({ contractAddress: contract(n) })),
        contractAddress: null,
        ttlScanOffset: 0,
      },
    ]);
    mockRpc.getLedgerEntries.mockRejectedValueOnce(new Error("settings outage"));
    await expect(mod.runTtlMaintenance()).rejects.toThrow("settings outage");
    mockRpc.getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
      if (keys[0]?.switch().name === "configSetting")
        return { latestLedger: 100, entries: [{ key: keys[0], val: settings }] };
      throw new Error("unavailable");
    });
    const result = await mod.runTtlMaintenance();
    expect(result.failedDeployments).toEqual(["dep"]);
    expect(mockDb.deployment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ttlCheckedAt: expect.any(Date), ttlScanOffset: 0 } }),
    );
  });
  it("shared configuration failures rotate independently and do not abort deployment discovery", async () => {
    const mod = await load();
    mockDb.contractTemplate.findMany.mockResolvedValue([
      { kind: "SUBSCRIPTION", wasmHash: "00invalid" },
      { kind: "WEBHOOK", wasmHash: HASH },
    ]);
    mockDb.deployment.findMany.mockResolvedValue([
      { id: "dep", pipelineSnapshot: null, contractAddress: contract(3), ttlScanOffset: 0 },
    ]);
    const result = await mod.runTtlMaintenance();
    expect(result.deployments).toBe(1);
    expect(result.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ target: "00invalid", status: "failed" })]),
    );
    expect(mockDb.ttlMaintenanceState.update).toHaveBeenCalledWith({
      where: { network: "testnet" },
      data: { sharedOffset: 0 },
    });
  });
  it("reports backlog beyond the bounded deployment batch", async () => {
    const mod = await load();
    mockDb.deployment.findMany.mockResolvedValue(
      Array.from({ length: 26 }, (_, n) => ({
        id: String(n),
        pipelineSnapshot: null,
        contractAddress: contract(n + 1),
        ttlScanOffset: 0,
      })),
    );
    const result = await mod.runTtlMaintenance();
    expect(result.deployments).toBe(25);
    expect(result.moreDeployments).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.budgetExhausted).toBe(false);
    expect(result.partialPipelines).toBe(false);
  });
  it("wraps large pipeline cursor after the last unique instance", async () => {
    const mod = await load();
    mockDb.deployment.findMany.mockResolvedValue([
      {
        id: "dep",
        pipelineSnapshot: [1, 2].map((n) => ({ contractAddress: contract(n) })),
        contractAddress: null,
        ttlScanOffset: 1,
      },
    ]);
    const result = await mod.runTtlMaintenance();
    expect(result.scans).toEqual([{ deploymentId: "dep", totalTargets: 2, nextOffset: 0 }]);
    expect(result.details[0]?.target).toBe(contract(2));
  });

  it("reads ten instances together and persists the remaining large-pipeline offset", async () => {
    const mod = await load();
    mockDb.deployment.findMany.mockResolvedValue([
      {
        id: "large",
        pipelineSnapshot: Array.from({ length: 25 }, (_, n) => ({
          contractAddress: contract(n + 1),
        })),
        contractAddress: null,
        ttlScanOffset: 0,
      },
    ]);
    const result = await mod.runTtlMaintenance();
    expect(result.scans).toEqual([{ deploymentId: "large", totalTargets: 25, nextOffset: 10 }]);
    expect(result.partialPipelines).toBe(true);
    expect(mockRpc.getLedgerEntries.mock.calls.some((keys) => keys.length === 10)).toBe(true);
    expect(result.details.filter((d) => d.kind === "instance")).toHaveLength(10);
    expect(mockDb.deployment.update).toHaveBeenCalledWith({
      where: { id: "large" },
      data: { ttlCheckedAt: expect.any(Date), ttlScanOffset: 10 },
    });
  });

  it("pools reads across deployments and leaves rows beyond an exhausted batch untouched", async () => {
    const mod = await load();
    mockDb.deployment.findMany.mockResolvedValue(
      Array.from({ length: 25 }, (_, row) => ({
        id: String(row),
        contractAddress: null,
        ttlScanOffset: 0,
        pipelineSnapshot: Array.from({ length: 10 }, (_, node) => ({
          contractAddress: contract(row * 10 + node + 1),
        })),
      })),
    );
    const implementation = mockRpc.getLedgerEntries.getMockImplementation()!;
    mockRpc.getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
      const response = await implementation(...keys);
      if (keys.length === 100) clock.expired = true;
      return response;
    });
    const result = await mod.runTtlMaintenance();
    expect(result.deployments).toBe(10);
    expect(result.budgetExhausted).toBe(true);
    expect(mockDb.deployment.update).toHaveBeenCalledTimes(10);
    expect(
      mockDb.deployment.update.mock.calls.every(([input]) => Number(input.where.id) < 10),
    ).toBe(true);
    expect(mockRpc.getLedgerEntries.mock.calls.filter((keys) => keys.length === 100)).toHaveLength(
      1,
    );
    expect(mockRpc.getLedgerEntries.mock.calls.every((keys) => keys.length <= 100)).toBe(true);
  });

  it("keeps fallback reads beyond the deadline eligible instead of repeatedly starving their rows", async () => {
    const mod = await load();
    mockDb.deployment.findMany.mockResolvedValue(
      Array.from({ length: 25 }, (_, n) => ({
        id: String(n),
        contractAddress: contract(n + 1),
        pipelineSnapshot: null,
        ttlScanOffset: 0,
      })),
    );
    const implementation = mockRpc.getLedgerEntries.getMockImplementation()!;
    let singles = 0;
    mockRpc.getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
      if (keys.length > 1) throw new Error("failed batch");
      if (keys[0]?.switch().name !== "configSetting") {
        if (++singles === 3) clock.expired = true;
      }
      return implementation(...keys);
    });
    const result = await mod.runTtlMaintenance();
    expect(result.deployments).toBe(3);
    expect(mockDb.deployment.update.mock.calls.map(([input]) => input.where.id)).toEqual([
      "0",
      "1",
      "2",
    ]);
    expect(result.details.filter((detail) => detail.status === "deferred")).toHaveLength(22);
  });

  it("caps fallback requests when a provider fails instantly without consuming the time budget", async () => {
    const mod = await load();
    mockDb.deployment.findMany.mockResolvedValue(
      Array.from({ length: 25 }, (_, row) => ({
        id: String(row),
        contractAddress: null,
        ttlScanOffset: 0,
        pipelineSnapshot: Array.from({ length: 10 }, (_, n) => ({
          contractAddress: contract(row * 10 + n + 1),
        })),
      })),
    );
    mockRpc.getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
      if (keys[0]?.switch().name === "configSetting")
        return { latestLedger: 100, entries: [{ key: keys[0], val: settings }] };
      throw new Error("provider failure");
    });
    const result = await mod.runTtlMaintenance();
    expect(result.inventoryReadLimitReached).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.budgetExhausted).toBe(false);
    expect(mockRpc.getLedgerEntries).toHaveBeenCalledTimes(mod.TTL_LIMITS.maxInventoryReads + 1);
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
    expect(result.deployments).toBeLessThan(25);
  });

  it("resumes shared fallback at the first unattempted target across deadline-limited ticks", async () => {
    const mod = await load();
    const hashes = Array.from({ length: 10 }, (_, n) => (n + 1).toString(16).padStart(64, "0"));
    mockDb.contractTemplate.findMany.mockResolvedValue(
      hashes.map((wasmHash, n) => ({ kind: Object.values(TemplateKind)[n]!, wasmHash })),
    );
    for (const hash of hashes)
      entries.set(mod.ttlCodeKey(hash).toXDR("base64"), {
        val: settings,
        liveUntilLedgerSeq: 600_000,
      });
    const cursor = { sharedOffset: 0, sharedFirst: true };
    mockDb.ttlMaintenanceState.upsert.mockImplementation(async () => ({ ...cursor }));
    mockDb.ttlMaintenanceState.update.mockImplementation(async ({ data }) => {
      Object.assign(cursor, data);
      return cursor;
    });
    const implementation = mockRpc.getLedgerEntries.getMockImplementation()!;
    const attemptedHashes: string[] = [];
    let singles = 0;
    mockRpc.getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
      if (keys.length > 1) throw new Error("failed batch");
      const key = keys[0]!;
      if (key.switch().name === "contractCode") {
        const hash = key.contractCode().hash().toString("hex");
        attemptedHashes.push(hash);
        if (++singles === 3) clock.expired = true;
        if (hash === hashes[0]) throw new Error("failed singleton");
      }
      return implementation(...keys);
    });
    for (const [tick, nextOffset] of [3, 6, 9, 0].entries()) {
      clock.expired = false;
      singles = 0;
      const result = await mod.runTtlMaintenance();
      expect(result.sharedScan).toEqual({ totalTargets: 10, nextOffset });
      expect(cursor.sharedOffset).toBe(nextOffset);
      expect(result.truncated).toBe(tick < 3);
      expect(result.budgetExhausted).toBe(tick < 3);
      expect(result.details.filter((detail) => detail.status === "deferred")).toHaveLength(
        tick < 3 ? 7 - tick * 3 : 0,
      );
      if (tick === 0)
        expect(result.details).toContainEqual(
          expect.objectContaining({ target: hashes[0], status: "failed" }),
        );
    }
    expect(attemptedHashes).toEqual(hashes);
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("retains shared fallback tails when deployment reads exhaust the request cap", async () => {
    const mod = await load();
    const hashes = Array.from({ length: 10 }, (_, n) => (n + 1).toString(16).padStart(64, "0"));
    mockDb.contractTemplate.findMany.mockResolvedValue(
      hashes.map((wasmHash, n) => ({ kind: Object.values(TemplateKind)[n]!, wasmHash })),
    );
    mockDb.deployment.findMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, n) => ({
        id: String(n),
        contractAddress: contract(n + 1),
        pipelineSnapshot: null,
        ttlScanOffset: 0,
      })),
    );
    const cursor = { sharedOffset: 0, sharedFirst: false };
    mockDb.ttlMaintenanceState.upsert.mockImplementation(async () => ({ ...cursor }));
    mockDb.ttlMaintenanceState.update.mockImplementation(async ({ data }) => {
      Object.assign(cursor, data);
      return cursor;
    });
    const implementation = mockRpc.getLedgerEntries.getMockImplementation()!;
    const attemptedHashes: string[] = [];
    mockRpc.getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
      if (keys.length > 1) throw new Error("failed batch");
      const key = keys[0]!;
      if (key.switch().name === "contractCode")
        attemptedHashes.push(key.contractCode().hash().toString("hex"));
      return implementation(...keys);
    });
    const first = await mod.runTtlMaintenance();
    const firstCount = attemptedHashes.length;
    expect(firstCount).toBeGreaterThan(0);
    expect(firstCount).toBeLessThan(hashes.length);
    expect(first.sharedScan).toEqual({ totalTargets: 10, nextOffset: firstCount });
    expect(cursor.sharedOffset).toBe(firstCount);
    expect(first.inventoryReadLimitReached).toBe(true);
    expect(first.truncated).toBe(true);
    expect(first.budgetExhausted).toBe(false);
    expect(mockRpc.getLedgerEntries).toHaveBeenCalledTimes(mod.TTL_LIMITS.maxInventoryReads + 1);

    const second = await mod.runTtlMaintenance();
    expect(second.sharedScan).toEqual({ totalTargets: 10, nextOffset: 0 });
    expect(cursor.sharedOffset).toBe(0);
    expect(attemptedHashes).toEqual(hashes);
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });
  it("isolates failed batched inventory reads without hiding a healthy neighbour", async () => {
    const mod = await load();
    mockDb.deployment.findMany.mockResolvedValue([
      {
        id: "dep",
        pipelineSnapshot: [1, 2].map((n) => ({ contractAddress: contract(n) })),
        contractAddress: null,
        ttlScanOffset: 0,
      },
    ]);
    const goodKey = mod.ttlInstanceKey(contract(2));
    entries.set(goodKey.toXDR("base64"), {
      val: instanceVal(contract(2)),
      liveUntilLedgerSeq: 600_000,
    });
    const implementation = mockRpc.getLedgerEntries.getMockImplementation()!;
    mockRpc.getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
      if (
        keys.some((key) => key.toXDR("base64") === mod.ttlInstanceKey(contract(1)).toXDR("base64"))
      )
        throw new Error("one failed key");
      return implementation(...keys);
    });
    const result = await mod.runTtlMaintenance();
    expect(result.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: contract(1), status: "failed" }),
        expect.objectContaining({ target: contract(2), status: "healthy" }),
        expect.objectContaining({ target: OLD_HASH, kind: "code" }),
      ]),
    );
    expect(result.failedDeployments).toEqual(["dep"]);
    expect(result.scans[0]?.nextOffset).toBe(0);
  });
  it("enabled maintenance never spends on missing keys, and independently handles due code", async () => {
    process.env.STELLAR_TTL_MAINTENANCE_ENABLED = "true";
    const mod = await load();
    const addr = contract(1);
    mockDb.deployment.findMany.mockResolvedValue([
      { id: "dep", pipelineSnapshot: null, contractAddress: addr, ttlScanOffset: 0 },
    ]);
    const missing = await mod.runTtlMaintenance();
    expect(missing.details[0]?.status).toBe("missing");
    expect(withChannel).not.toHaveBeenCalled();
    entries.set(mod.ttlInstanceKey(addr).toXDR("base64"), {
      val: instanceVal(addr),
      liveUntilLedgerSeq: 600_000,
    });
    entries.set(mod.ttlCodeKey(OLD_HASH).toXDR("base64"), {
      val: settings,
      liveUntilLedgerSeq: 50_100,
    });
    withChannel.mockRejectedValueOnce(new Error("channel outage"));
    const dueCode = await mod.runTtlMaintenance();
    expect(dueCode.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: addr, status: "healthy" }),
        expect.objectContaining({
          target: OLD_HASH,
          status: "failed",
          reason: "RPC or channel unavailable",
        }),
      ]),
    );
    expect(dueCode.submissions).toBe(1);
    expect(withChannel).toHaveBeenCalledOnce();
  });
  it("audit failure never reclassifies confirmed rent or resubmits it", async () => {
    process.env.STELLAR_TTL_MAINTENANCE_ENABLED = "true";
    const mod = await load();
    const addr = contract(1);
    mockDb.deployment.findMany.mockResolvedValue([
      { id: "dep", pipelineSnapshot: null, contractAddress: addr, ttlScanOffset: 0 },
    ]);
    entries.set(mod.ttlInstanceKey(addr).toXDR("base64"), {
      val: instanceVal(addr),
      liveUntilLedgerSeq: 50_100,
    });
    withChannel.mockImplementationOnce(async () => {
      entries.set(mod.ttlInstanceKey(addr).toXDR("base64"), {
        val: instanceVal(addr),
        liveUntilLedgerSeq: 500_100,
      });
      return { txHash: "aa".repeat(32), feeStroops: "300" };
    });
    mockDb.auditLog.create.mockRejectedValueOnce(new Error("DB unavailable"));
    const result = await mod.runTtlMaintenance();
    expect(result.details[0]).toMatchObject({
      status: "extended",
      liveUntilLedger: 500_100,
      txHash: "aa".repeat(32),
    });
    expect(result.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: OLD_HASH, kind: "code", status: "missing" }),
      ]),
    );
    expect(withChannel).toHaveBeenCalledOnce();
    expect(mockDb.auditLog.create).toHaveBeenCalledOnce();
  });
  it.each(["throws", "missing"])(
    "post-read %s preserves confirmed rent and never retries",
    async (mode) => {
      process.env.STELLAR_TTL_MAINTENANCE_ENABLED = "true";
      const mod = await load();
      const addr = contract(1);
      const key = mod.ttlInstanceKey(addr);
      mockDb.deployment.findMany.mockResolvedValue([
        { id: "dep", pipelineSnapshot: null, contractAddress: addr, ttlScanOffset: 0 },
      ]);
      entries.set(key.toXDR("base64"), { val: instanceVal(addr), liveUntilLedgerSeq: 50_100 });
      withChannel.mockResolvedValueOnce({ txHash: "aa".repeat(32), feeStroops: "300" });
      let reads = 0;
      mockRpc.getLedgerEntries.mockImplementation(async (...keys: xdr.LedgerKey[]) => {
        if (keys[0]?.switch().name === "configSetting")
          return { latestLedger: 100, entries: [{ key: keys[0], val: settings }] };
        if (keys[0]?.toXDR("base64") === key.toXDR("base64") && ++reads > 1) {
          if (mode === "throws") throw new Error("read outage");
          return { latestLedger: 100, entries: [] };
        }
        return {
          latestLedger: 100,
          entries: keys.flatMap((k) => {
            const e = entries.get(k.toXDR("base64"));
            return e ? [{ key: k, ...e }] : [];
          }),
        };
      });
      const result = await mod.runTtlMaintenance();
      expect(result.details[0]).toMatchObject({
        status: "extended",
        postReadUnavailable: true,
        txHash: "aa".repeat(32),
      });
      expect(result.details[0]?.liveUntilLedger).toBeUndefined();
      expect(withChannel).toHaveBeenCalledOnce();
      expect(result.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ target: OLD_HASH, kind: "code" })]),
      );
    },
  );

  it.each(["healthy", "missing"])(
    "rechecks %s state under the channel lock before spending from a stale due observation",
    async (status) => {
      process.env.STELLAR_TTL_MAINTENANCE_ENABLED = "true";
      const mod = await load();
      const address = contract(1);
      const key = mod.ttlInstanceKey(address).toXDR("base64");
      mockDb.deployment.findMany.mockResolvedValue([
        { id: "dep", pipelineSnapshot: null, contractAddress: address, ttlScanOffset: 0 },
      ]);
      entries.set(key, { val: instanceVal(address), liveUntilLedgerSeq: 101 });
      withChannel.mockImplementationOnce(
        async (fn: (channel: RelayerChannel) => Promise<unknown>) => {
          if (status === "healthy")
            entries.set(key, { val: instanceVal(address), liveUntilLedgerSeq: 600_000 });
          else entries.delete(key);
          const kp = Keypair.random();
          return fn({
            keypair: kp,
            publicKey: kp.publicKey(),
            relayerSigner: kp,
            index: 0,
            isRelayerSource: true,
            trackPending: vi.fn(),
          });
        },
      );
      const result = await mod.runTtlMaintenance();
      expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
      expect(mockRpc.simulateTransaction).not.toHaveBeenCalled();
      expect(result.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            target: address,
            status: status === "healthy" ? "healthy" : "failed",
          }),
        ]),
      );
      if (status === "healthy")
        expect(result.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ target: OLD_HASH, kind: "code" })]),
        );
      expect(mockDb.auditLog.create).not.toHaveBeenCalled();
    },
  );
  it("deduplicates the actual shared code across deployment instances", async () => {
    const mod = await load();
    mockDb.deployment.findMany.mockResolvedValue(
      [1, 2].map((n) => ({
        id: String(n),
        pipelineSnapshot: null,
        contractAddress: contract(n),
        ttlScanOffset: 0,
      })),
    );
    for (const n of [1, 2])
      entries.set(mod.ttlInstanceKey(contract(n)).toXDR("base64"), {
        val: instanceVal(contract(n)),
        liveUntilLedgerSeq: 600_000,
      });
    const result = await mod.runTtlMaintenance();
    expect(result.details.filter((d) => d.target === OLD_HASH)).toHaveLength(1);
  });
  it("skips deployment work at the time budget without advancing its cursor", async () => {
    const mod = await load();
    clock.expired = true;
    mockDb.deployment.findMany.mockResolvedValue([{ id: "dep" }]);
    expect((await mod.runTtlMaintenance()).truncated).toBe(true);
    expect(mockDb.deployment.update).not.toHaveBeenCalled();
  });
});

describe("TTL transaction safety", () => {
  const kp = Keypair.random();
  const channel: RelayerChannel = {
    keypair: kp,
    publicKey: kp.publicKey(),
    relayerSigner: kp,
    index: 0,
    isRelayerSource: false,
    trackPending: vi.fn(),
    clearPending: vi.fn(),
  };
  beforeEach(() => {
    mockRpc.getAccount.mockResolvedValue(new Account(kp.publicKey(), "1"));
    mockRpc.simulateTransaction.mockResolvedValue({
      _parsed: true,
      latestLedger: 100,
      transactionData: new SorobanDataBuilder().setResourceFee("200"),
      minResourceFee: "200",
      events: [],
    });
    mockRpc.sendTransaction.mockResolvedValue({ status: "PENDING" });
    mockRpc.getTransaction.mockResolvedValue({ status: "SUCCESS" });
  });
  it("rejects raised-cap paid runs without a cumulative budget before any chain reads", async () => {
    process.env.STELLAR_TTL_MAINTENANCE_ENABLED = "true";
    process.env.STELLAR_TTL_MAX_FEE_STROOPS = "500000000";
    const mod = await load();
    await expect(mod.runTtlMaintenance()).rejects.toThrow("cumulative fee budget");
    expect(mockRpc.getLedgerEntries).not.toHaveBeenCalled();
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });
  it("failed durable reservation prevents signing, pending tracking and submission", async () => {
    process.env.STELLAR_TTL_FEE_BUDGET_NAME = "ttl804-testnet-20261004";
    process.env.STELLAR_TTL_FEE_BUDGET_STROOPS = "1500000000";
    reserveFee.mockRejectedValueOnce(new Error("budget exhausted"));
    const sign = vi.spyOn(channel.keypair, "sign");
    const mod = await load();
    await expect(
      mod.submitTtlOperation(
        mockRpc as unknown as import("@stellar/stellar-sdk").rpc.Server,
        channel,
        mod.ttlCodeKey(HASH),
        500_000,
        "500000000",
      ),
    ).rejects.toThrow("budget exhausted");
    expect(sign).not.toHaveBeenCalled();
    expect(channel.trackPending).not.toHaveBeenCalled();
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
    sign.mockRestore();
  });
  it("a successful reservation precedes submission and survives an uncertain transport outcome", async () => {
    process.env.STELLAR_TTL_FEE_BUDGET_NAME = "ttl804-testnet-20261004";
    process.env.STELLAR_TTL_FEE_BUDGET_STROOPS = "1500000000";
    mockRpc.sendTransaction.mockRejectedValueOnce(new Error("transport"));
    const mod = await load();
    await expect(
      mod.submitTtlOperation(
        mockRpc as unknown as import("@stellar/stellar-sdk").rpc.Server,
        channel,
        mod.ttlCodeKey(HASH),
        null,
        "500000000",
      ),
    ).rejects.toThrow("finality unknown");
    expect(reserveFee).toHaveBeenCalledWith(
      expect.objectContaining({
        budget: { name: "ttl804-testnet-20261004", limitStroops: "1500000000" },
        payer: channel.publicKey,
        declaredFeeStroops: "300",
        purpose: "ttl-restoration",
      }),
    );
    expect(reserveFee.mock.invocationCallOrder[0]).toBeLessThan(
      mockRpc.sendTransaction.mock.invocationCallOrder[0]!,
    );
    expect(channel.clearPending).not.toHaveBeenCalled();
  });
  it("assembles exact read-only extension footprint, caps fee, signs with channel and waits for finality", async () => {
    const mod = await load();
    const key = mod.ttlInstanceKey(contract(1));
    const result = await mod.submitTtlOperation(
      mockRpc as unknown as import("@stellar/stellar-sdk").rpc.Server,
      channel,
      key,
      500_000,
      "1000000",
    );
    const tx = mockRpc.sendTransaction.mock.calls[0]![0];
    expect(tx.operations[0].type).toBe("extendFootprintTtl");
    expect(tx.networkPassphrase).toBe(Networks.TESTNET);
    expect(tx.signatures).toHaveLength(1);
    expect(result.feeStroops).toBe("300");
    expect(channel.clearPending).toHaveBeenCalledWith(result.txHash);
  });
  it("does not sign/send when fee exceeds cap or restore simulation errors", async () => {
    const mod = await load();
    const server = mockRpc as unknown as import("@stellar/stellar-sdk").rpc.Server;
    await expect(
      mod.submitTtlOperation(server, channel, mod.ttlCodeKey(HASH), 500_000, "1"),
    ).rejects.toThrow("fee exceeds");
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
    mockRpc.simulateTransaction.mockResolvedValue({ error: "not archived", latestLedger: 100 });
    await expect(
      mod.submitTtlOperation(server, channel, mod.ttlCodeKey(HASH), null, "1000000"),
    ).rejects.toThrow("simulation");
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });
  it("preserves pending hash on uncertain send and never retries", async () => {
    const mod = await load();
    mockRpc.sendTransaction.mockRejectedValue(new Error("transport unavailable"));
    await expect(
      mod.submitTtlOperation(
        mockRpc as unknown as import("@stellar/stellar-sdk").rpc.Server,
        channel,
        mod.ttlCodeKey(HASH),
        500_000,
        "1000000",
      ),
    ).rejects.toThrow("finality unknown");
    expect(channel.trackPending).toHaveBeenCalledOnce();
    expect(channel.clearPending).not.toHaveBeenCalled();
    expect(mockRpc.sendTransaction).toHaveBeenCalledOnce();
  });
  it("hung finality returns at the remaining run budget with its pending identity intact", async () => {
    vi.useFakeTimers();
    const mod = await load();
    const { ttlDeadline } = await vi.importActual<typeof import("@/lib/stellar/ttl-deadline")>(
      "@/lib/stellar/ttl-deadline",
    );
    mockRpc.getTransaction.mockImplementationOnce(() => new Promise(() => {}));
    const deadline = ttlDeadline(20_000);
    await vi.advanceTimersByTimeAsync(15_000);
    const call = mod.submitTtlOperation(
      mockRpc as unknown as import("@stellar/stellar-sdk").rpc.Server,
      channel,
      mod.ttlCodeKey(HASH),
      500_000,
      "1000000",
      deadline,
    );
    const rejected = expect(call).rejects.toMatchObject({
      txHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      feeStroops: "300",
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    expect(channel.trackPending).toHaveBeenCalledOnce();
    expect(channel.clearPending).not.toHaveBeenCalled();
    expect(mockRpc.sendTransaction).toHaveBeenCalledOnce();
  });
  it("does not sign after a fee reservation outlasts the run budget", async () => {
    vi.useFakeTimers();
    process.env.STELLAR_TTL_FEE_BUDGET_NAME = "ttl804-testnet-20261004";
    process.env.STELLAR_TTL_FEE_BUDGET_STROOPS = "1500000000";
    const mod = await load();
    const { ttlDeadline } = await vi.importActual<typeof import("@/lib/stellar/ttl-deadline")>(
      "@/lib/stellar/ttl-deadline",
    );
    reserveFee.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 21_000));
    });
    const sign = vi.spyOn(channel.keypair, "sign");
    const call = mod.submitTtlOperation(
      mockRpc as unknown as import("@stellar/stellar-sdk").rpc.Server,
      channel,
      mod.ttlCodeKey(HASH),
      500_000,
      "500000000",
      ttlDeadline(20_000),
    );
    const rejected = expect(call).rejects.toThrow("time budget exhausted");
    await vi.advanceTimersByTimeAsync(21_000);
    await rejected;
    expect(sign).not.toHaveBeenCalled();
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
    expect(channel.trackPending).not.toHaveBeenCalled();
    sign.mockRestore();
  });
});
