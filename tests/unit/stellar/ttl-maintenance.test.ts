import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Address, Keypair, Networks, SorobanDataBuilder, xdr } from "@stellar/stellar-sdk";
import type { RelayerChannel } from "@/lib/stellar/relayer-channels";

const { mockDb, mockRpc, withChannel, clock } = vi.hoisted(() => ({
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
vi.mock("@/lib/cron/deadline", () => ({ cronDeadline: () => ({ expired: () => clock.expired }) }));

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
  return import("@/lib/stellar/ttl-maintenance");
}
beforeEach(() => {
  vi.clearAllMocks();
  entries.clear();
  clock.expired = false;
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
    expect(() => mod.ttlSnapshotAddresses([{ contractAddress: "bad" }], contract(2))).toThrow();
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
    expect(result.scans).toEqual([{ deploymentId: "dep", totalTargets: 2, nextOffset: 1 }]);
    expect(mockDb.deployment.update).toHaveBeenCalledWith({
      where: { id: "dep" },
      data: { ttlCheckedAt: expect.any(Date), ttlScanOffset: 1 },
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
      expect.objectContaining({ data: { ttlCheckedAt: expect.any(Date), ttlScanOffset: 1 } }),
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
    expect(result.details[0]?.status).toBe("failed");
    expect(mockDb.ttlMaintenanceState.update).toHaveBeenCalledWith({
      where: { network: "testnet" },
      data: { sharedOffset: 1 },
    });
  });
  it("reports backlog beyond the bounded deployment batch", async () => {
    const mod = await load();
    mockDb.deployment.findMany.mockResolvedValue(
      Array.from({ length: 6 }, (_, n) => ({
        id: String(n),
        pipelineSnapshot: null,
        contractAddress: contract(n + 1),
        ttlScanOffset: 0,
      })),
    );
    const result = await mod.runTtlMaintenance();
    expect(result.deployments).toBe(5);
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
    ).rejects.toThrow("transport");
    expect(channel.trackPending).toHaveBeenCalledOnce();
    expect(channel.clearPending).not.toHaveBeenCalled();
    expect(mockRpc.sendTransaction).toHaveBeenCalledOnce();
  });
});
