import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  Account,
  Address,
  Keypair,
  SorobanDataBuilder,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";
import { Prisma, TemplateKind } from "@prisma/client";
import type { RelayerChannel } from "@/lib/stellar/relayer-channels";
import type { TtlDetail, TtlSummary } from "@/lib/stellar/ttl-maintenance";

const state = vi.hoisted(() => ({
  rpc: {} as Record<string, unknown>,
  channel: undefined as RelayerChannel | undefined,
  pending: new Map<string, string>(),
  queries: 0,
  reconcile: undefined as (() => void) | undefined,
  db: undefined as import("@prisma/client").PrismaClient | undefined,
}));

// Real Prisma queries with query counts; the application's selection/order/updates are unchanged.
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!state.db) {
    const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
    client.$on("query", () => state.queries++);
    state.db = client;
  }
  return { db: state.db };
});
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => state.rpc }));
vi.mock("@/lib/stellar/relayer-channels", () => ({
  withRelayerChannel: async (fn: (channel: RelayerChannel) => Promise<unknown>) => {
    state.reconcile?.();
    if (state.pending.size) throw new Error("Synthetic unresolved source blocks submissions");
    if (!state.channel) throw new Error("Synthetic channel unavailable");
    return fn(state.channel);
  },
}));

const START = Date.parse("2026-10-05T00:00:00Z");
const CADENCE_MS = 60_000;
const GATE_MS = 6 * 60 * 60_000;
const MAX_TICKS = 1_600;
const hash = (label: string) => createHash("sha256").update(label).digest("hex");
const contract = (label: string) => Address.contract(Buffer.from(hash(label), "hex")).toString();
type Fault = "none" | "transient-read" | "persistent-read" | "missing" | "fee-cap" | "uncertain";
type Scenario = {
  name: string;
  pipelines: number;
  contracts: number;
  largest?: number;
  readMs: number;
  paid: boolean;
  finalityMs?: number;
  archived?: boolean;
  fault?: Fault;
  recoverAfterTicks?: number;
  stopAtGate?: boolean;
  cycles?: number;
};
const scenarios: Scenario[] = [
  { name: "healthy-100x3", pipelines: 100, contracts: 3, readMs: 350, paid: false },
  {
    name: "steady-100x3-two-cycles",
    pipelines: 100,
    contracts: 3,
    readMs: 350,
    paid: false,
    cycles: 2,
  },
  { name: "healthy-100x10", pipelines: 100, contracts: 10, readMs: 350, paid: false },
  {
    name: "healthy-mixed-100",
    pipelines: 100,
    contracts: 3,
    largest: 10,
    readMs: 350,
    paid: false,
  },
  { name: "healthy-growth-700x10", pipelines: 700, contracts: 10, readMs: 350, paid: false },
  { name: "slow-100x10", pipelines: 100, contracts: 10, readMs: 3_000, paid: false },
  {
    name: "transient-reads-100x3",
    pipelines: 100,
    contracts: 3,
    readMs: 350,
    paid: false,
    fault: "transient-read",
  },
  {
    name: "persistent-reads-100x3",
    pipelines: 100,
    contracts: 3,
    readMs: 350,
    paid: false,
    fault: "persistent-read",
    stopAtGate: true,
  },
  {
    name: "missing-100x3",
    pipelines: 100,
    contracts: 3,
    readMs: 350,
    paid: false,
    fault: "missing",
    stopAtGate: true,
  },
  { name: "paid-100x3", pipelines: 100, contracts: 3, readMs: 350, paid: true, finalityMs: 5_000 },
  {
    name: "paid-100x3-two-cycles",
    pipelines: 100,
    contracts: 3,
    readMs: 350,
    paid: true,
    finalityMs: 5_000,
    cycles: 2,
  },
  {
    name: "paid-100x10",
    pipelines: 100,
    contracts: 10,
    readMs: 350,
    paid: true,
    finalityMs: 5_000,
  },
  {
    name: "slow-paid-100x3",
    pipelines: 100,
    contracts: 3,
    readMs: 350,
    paid: true,
    finalityMs: 30_000,
  },
  {
    name: "slow-paid-100x10",
    pipelines: 100,
    contracts: 10,
    readMs: 350,
    paid: true,
    finalityMs: 30_000,
  },
  {
    name: "archived-100x3",
    pipelines: 100,
    contracts: 3,
    readMs: 350,
    paid: true,
    finalityMs: 5_000,
    archived: true,
  },
  {
    name: "fee-rejection-100x3",
    pipelines: 100,
    contracts: 3,
    readMs: 350,
    paid: true,
    finalityMs: 5_000,
    fault: "fee-cap",
    stopAtGate: true,
  },
  {
    name: "fee-recovery-100x3",
    pipelines: 100,
    contracts: 3,
    readMs: 350,
    paid: true,
    finalityMs: 5_000,
    fault: "fee-cap",
    recoverAfterTicks: 100,
  },
  {
    name: "uncertain-finality-100x3",
    pipelines: 100,
    contracts: 3,
    readMs: 350,
    paid: true,
    finalityMs: 5_000,
    fault: "uncertain",
    stopAtGate: true,
  },
];

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
function instanceVal(address: string, wasmHash: string) {
  return xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: new xdr.ExtensionPoint(0),
      contract: new Address(address).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
      val: xdr.ScVal.scvContractInstance(
        new xdr.ScContractInstance({
          executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.from(wasmHash, "hex")),
          storage: null,
        }),
      ),
    }),
  );
}
function codeVal(wasmHash: string) {
  return xdr.LedgerEntryData.contractCode(
    new xdr.ContractCodeEntry({
      ext: new xdr.ContractCodeEntryExt(0),
      hash: Buffer.from(wasmHash, "hex"),
      code: Buffer.alloc(0),
    }),
  );
}

let db: typeof import("@/lib/db").db;
let redis: NonNullable<ReturnType<typeof import("@/lib/redis").redis>>;
let maintenance: typeof import("@/lib/stellar/ttl-maintenance");
let lease: typeof import("@/lib/cron/lease").withCronLease;
const results: Record<string, unknown>[] = [];
const ownerId = randomUUID();
const sandboxId = randomUUID();
const flowId = randomUUID();
const sandboxFlowId = randomUUID();
const factoryAddress = contract("factory");
const currentHashes = Object.values(TemplateKind).map((kind) => hash(`current-${kind}`));
const historicalHashes = Array.from({ length: 6 }, (_, i) => hash(`historical-${i}`));
const factoryHash = hash("factory-code");
const toId = (i: number) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
const rehearsalOwner = randomUUID();
let ownsFixtures = false;
let ownsRehearsalLease = false;

beforeAll(async () => {
  vi.resetModules();
  ({ db } = await import("@/lib/db"));
  maintenance = await import("@/lib/stellar/ttl-maintenance");
  ({ withCronLease: lease } = await import("@/lib/cron/lease"));
  const redisModule = await import("@/lib/redis");
  const client = redisModule.redis();
  if (!client) throw new Error("Real Redis is required");
  redis = client;
  if (redis.status !== "ready")
    await new Promise<void>((resolve, reject) => {
      redis.once("ready", resolve);
      redis.once("error", reject);
    });
  if ((await redis.set("ttl-capacity:rehearsal", rehearsalOwner, "PX", 600_000, "NX")) !== "OK")
    throw new Error("Another local capacity rehearsal is running");
  ownsRehearsalLease = true;
  // Fail closed on an occupied database. Never truncate an existing checkout's data.
  // Delegate names come exclusively from the generated schema, never CLI/user input.
  const delegates = db as unknown as Record<string, { count(): Promise<number> }>;
  for (const model of Prisma.dmmf.datamodel.models) {
    const name = model.name[0]!.toLowerCase() + model.name.slice(1);
    const delegate = delegates[name];
    if (!delegate || (await delegate.count()) !== 0)
      throw new Error("Capacity rehearsal requires an empty dedicated database");
  }
  if ((await redis.dbsize()) !== 1)
    throw new Error("Capacity rehearsal requires empty dedicated Redis");
  ownsFixtures = true;
  await db.user.createMany({
    data: [
      {
        id: ownerId,
        username: "capacity-owner",
        passwordHash: "unusable-local-fixture",
        role: "USER",
      },
      {
        id: sandboxId,
        username: "capacity-sandbox",
        passwordHash: "unusable-local-fixture",
        role: "SANDBOX",
      },
    ],
  });
  await db.flow.createMany({
    data: [
      { id: flowId, ownerId, name: "capacity", templateKind: "PAYER", graph: {}, parameters: {} },
      {
        id: sandboxFlowId,
        ownerId: sandboxId,
        name: "sandbox-excluded",
        templateKind: "PAYER",
        graph: {},
        parameters: {},
      },
    ],
  });
  await db.contractTemplate.createMany({
    data: Object.values(TemplateKind).map((kind, i) => ({
      kind,
      network: "testnet",
      wasmHash: currentHashes[i]!,
      abiJson: {},
    })),
  });
  await db.factoryDeployment.create({
    data: { network: "testnet", address: factoryAddress, wasmHash: factoryHash },
  });
});

afterAll(async () => {
  vi.useRealTimers();
  // These clients connect only to the fixed, guarded disposable services.
  try {
    if (db && ownsFixtures)
      await db.$transaction([
        db.auditLog.deleteMany(),
        db.deployment.deleteMany(),
        db.ttlMaintenanceState.deleteMany(),
        db.factoryDeployment.deleteMany(),
        db.contractTemplate.deleteMany(),
        db.flow.deleteMany(),
        db.user.deleteMany(),
      ]);
  } finally {
    if (redis) {
      if (ownsRehearsalLease)
        await redis.eval(
          'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
          1,
          "ttl-capacity:rehearsal",
          rehearsalOwner,
        );
      await redis.quit();
    }
    if (db) await db.$disconnect();
  }
});

async function runScenario(scenario: Scenario) {
  vi.useRealTimers();
  await db.auditLog.deleteMany();
  await db.deployment.deleteMany();
  await db.ttlMaintenanceState.deleteMany();
  state.pending.clear();
  state.reconcile = undefined;
  let clockMs = START;
  const entries = new Map<
    string,
    { target: string; kind: "instance" | "code"; val: xdr.LedgerEntryData; liveUntil: number }
  >();
  const affected = new Set<string>();
  const readAttempts = new Map<string, number>();
  const inspected = new Set<string>();
  const serviced = new Set<string>();
  const cycleServiced = new Set<string>();
  const completedCycleTimesMs: number[] = [];
  const lastInspected = new Map<string, number>();
  const lastServiced = new Map<string, number>();
  const unresolvedPending = new Set<string>();
  const readsByTarget = new Map<string, number>();
  const rpcCalls: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  const operations: Record<string, number> = {};
  const confirmedTransactions = new Set<string>();
  const sentTransactions = new Map<string, { target: string; key: string; confirmsAt: number }>();
  let tick = 0;
  let sequence = 1;
  let simulatedFees = 0n;
  let networkRequests = 0;
  const ledger = () => 1_000_000 + Math.floor((clockMs - START) / 5_000);
  const spendTime = (ms: number) => {
    clockMs += ms;
    vi.setSystemTime(clockMs);
  };
  const rpcCall = (method: string, ms = scenario.readMs) => {
    rpcCalls[method] = (rpcCalls[method] ?? 0) + 1;
    spendTime(ms);
  };
  const put = (target: string, kind: "instance" | "code", val: xdr.LedgerEntryData) => {
    const key = (
      kind === "instance" ? maintenance.ttlInstanceKey(target) : maintenance.ttlCodeKey(target)
    ).toXDR("base64");
    entries.set(key, {
      target,
      kind,
      val,
      liveUntil: scenario.paid ? (scenario.archived ? 999_999 : 1_005_000) : 1_500_000,
    });
  };
  currentHashes.concat(historicalHashes, factoryHash).forEach((h) => put(h, "code", codeVal(h)));
  put(factoryAddress, "instance", instanceVal(factoryAddress, factoryHash));
  const deploymentRows: Prisma.DeploymentCreateManyInput[] = [];
  for (let i = 0; i < scenario.pipelines; i++) {
    const size = i === 0 ? (scenario.largest ?? scenario.contracts) : scenario.contracts;
    const pipelineSnapshot = Array.from({ length: size }, (_, node) => {
      const address = contract(`${i}-${node}`);
      const h = (node % 2 ? historicalHashes : currentHashes)[
        (i + node) % (node % 2 ? historicalHashes.length : currentHashes.length)
      ]!;
      put(address, "instance", instanceVal(address, h));
      if ((i * scenario.contracts + node) % 20 === 0) affected.add(address);
      return { nodeId: `node-${node}`, contractAddress: address, templateKind: "PAYER" };
    });
    deploymentRows.push({
      id: toId(i),
      flowId,
      ownerId,
      network: "testnet",
      status: "CONFIRMED",
      pipelineSnapshot,
      graphSnapshot: {},
      paramsSnapshot: {},
      chargeEndAt: new Date(START - 86_400_000),
    });
  }
  deploymentRows.push(
    {
      id: randomUUID(),
      flowId: sandboxFlowId,
      ownerId: sandboxId,
      network: "testnet",
      status: "CONFIRMED",
      pipelineSnapshot: [{ contractAddress: contract("excluded-sandbox") }],
      graphSnapshot: {},
      paramsSnapshot: {},
    },
    {
      id: randomUUID(),
      flowId,
      ownerId,
      network: "testnet",
      status: "FAILED",
      pipelineSnapshot: [{ contractAddress: contract("excluded-failed") }],
      graphSnapshot: {},
      paramsSnapshot: {},
    },
    {
      id: randomUUID(),
      flowId,
      ownerId,
      network: "mainnet",
      status: "CONFIRMED",
      pipelineSnapshot: [{ contractAddress: contract("excluded-mainnet") }],
      graphSnapshot: {},
      paramsSnapshot: {},
    },
  );
  await db.deployment.createMany({ data: deploymentRows });
  process.env.STELLAR_TTL_MAINTENANCE_ENABLED = String(scenario.paid);
  vi.resetModules();
  maintenance = await import("@/lib/stellar/ttl-maintenance");
  // Same real Prisma/Redis modules across scenario env memo resets.
  ({ withCronLease: lease } = await import("@/lib/cron/lease"));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clockMs);
  const signer = Keypair.random();
  state.channel = {
    keypair: signer,
    relayerSigner: signer,
    publicKey: signer.publicKey(),
    index: 0,
    isRelayerSource: false,
    trackPending: (txHash) => {
      state.pending.set(txHash, "pending");
    },
    clearPending: (txHash) => {
      state.pending.delete(txHash);
    },
  };
  const faultActive = () =>
    scenario.recoverAfterTicks === undefined || tick < scenario.recoverAfterTicks;
  const confirmTransactions = () => {
    for (const [txHash, submitted] of sentTransactions) {
      if (
        scenario.fault !== "uncertain" &&
        submitted.confirmsAt <= clockMs &&
        !confirmedTransactions.has(txHash)
      ) {
        entries.get(submitted.key)!.liveUntil = ledger() + maintenance.TTL_LIMITS.extendTo;
        confirmedTransactions.add(txHash);
      }
    }
  };
  Object.assign(state.rpc, {
    getLatestLedger: async () => {
      rpcCall("getLatestLedger");
      return { sequence: ledger() };
    },
    getLedgerEntries: async (...keys: xdr.LedgerKey[]) => {
      rpcCall("getLedgerEntries");
      confirmTransactions();
      const returned: Array<{
        key: xdr.LedgerKey;
        val: xdr.LedgerEntryData;
        liveUntilLedgerSeq?: number;
      }> = [];
      for (const key of keys) {
        if (key.switch().name === "configSetting") {
          returned.push({ key, val: settings });
          continue;
        }
        const entry = entries.get(key.toXDR("base64"));
        if (!entry) throw new Error("Synthetic target was not in the eligible inventory");
        const attempts = (readAttempts.get(entry.target) ?? 0) + 1;
        readAttempts.set(entry.target, attempts);
        readsByTarget.set(entry.target, (readsByTarget.get(entry.target) ?? 0) + 1);
        if (affected.has(entry.target) && faultActive()) {
          if (
            scenario.fault === "persistent-read" ||
            (scenario.fault === "transient-read" && attempts === 1)
          )
            throw new Error("Synthetic RPC read failure");
          if (scenario.fault === "missing") continue;
        }
        inspected.add(entry.target);
        lastInspected.set(entry.target, clockMs);
        returned.push({ key, val: entry.val, liveUntilLedgerSeq: entry.liveUntil });
      }
      return { latestLedger: ledger(), entries: returned };
    },
    getAccount: async () => {
      rpcCall("getAccount");
      return new Account(signer.publicKey(), String(sequence));
    },
    simulateTransaction: async (tx: Transaction) => {
      rpcCall("simulateTransaction");
      const footprint = tx.toEnvelope().v1().tx().ext().sorobanData().resources().footprint();
      const key = [...footprint.readOnly(), ...footprint.readWrite()][0]!;
      const entry = entries.get(key.toXDR("base64"))!;
      const fee =
        scenario.fault === "fee-cap" && affected.has(entry.target) && faultActive()
          ? "1000001"
          : "40000";
      return {
        _parsed: true,
        latestLedger: ledger(),
        transactionData: new SorobanDataBuilder()
          .setReadOnly(footprint.readOnly())
          .setReadWrite(footprint.readWrite())
          .setResourceFee(fee),
        minResourceFee: fee,
        events: [],
      };
    },
    sendTransaction: async (tx: Transaction) => {
      rpcCall("sendTransaction");
      const footprint = tx.toEnvelope().v1().tx().ext().sorobanData().resources().footprint();
      const key = [...footprint.readOnly(), ...footprint.readWrite()][0]!.toXDR("base64");
      const entry = entries.get(key)!;
      const txHash = tx.hash().toString("hex");
      simulatedFees += BigInt(tx.fee);
      operations[tx.operations[0]!.type] = (operations[tx.operations[0]!.type] ?? 0) + 1;
      sentTransactions.set(txHash, {
        target: entry.target,
        key,
        confirmsAt: clockMs + (scenario.finalityMs ?? 5_000),
      });
      sequence++;
      if (scenario.fault === "uncertain" && sentTransactions.size === 1) {
        unresolvedPending.add(entry.target);
        throw new Error("Synthetic accepted send with lost response");
      }
      return { status: "PENDING" };
    },
    getTransaction: async (txHash: string) => {
      const submitted = sentTransactions.get(txHash)!;
      const delay = Math.max(0, submitted.confirmsAt - clockMs);
      const remaining = START + tick * CADENCE_MS + maintenance.TTL_LIMITS.budgetMs - clockMs;
      rpcCall("getTransaction", Math.min(delay, remaining));
      if (delay > remaining) throw new Error("Synthetic finality read reached run deadline");
      confirmTransactions();
      return { status: "SUCCESS" };
    },
  });
  state.reconcile = () => {
    confirmTransactions();
    for (const txHash of state.pending.keys()) {
      const submitted = sentTransactions.get(txHash);
      if (scenario.fault !== "uncertain" && submitted && submitted.confirmsAt <= clockMs) {
        state.pending.delete(txHash);
      }
    }
  };
  // Catch accidental fallback to the real SDK or any other network client.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    networkRequests++;
    throw new Error("External HTTP is forbidden in the local capacity rehearsal");
  };
  const originalQueries = state.queries;
  const wallStart = performance.now();
  const durations: number[] = [];
  const wallDurations: number[] = [];
  let firstInventoryMs: number | null = null;
  let firstMaintenanceMs: number | null = null;
  let exhaustedTicks = 0;
  let failedDeploymentAttempts = 0;
  let maxAttempts = 0;
  let maxRpcPerTick = 0;
  let gateSnapshot: { inspected: number; serviced: number; unresolved: number } | null = null;
  let leaseBlocked = false;
  const updateCoverage = (detail: TtlDetail) => {
    statusCounts[detail.status] = (statusCounts[detail.status] ?? 0) + 1;
    if (
      ["healthy", "extended", "restored"].includes(detail.status) &&
      !detail.postReadUnavailable &&
      !unresolvedPending.has(detail.target)
    ) {
      serviced.add(detail.target);
      cycleServiced.add(detail.target);
      lastServiced.set(detail.target, clockMs);
    }
  };
  try {
    // Actual Redis-held lease must block the callback and leave DB/RPC untouched.
    await redis.set(
      "cron:maintain-ttl",
      "capacity-owner",
      "PX",
      maintenance.TTL_LIMITS.ttlMs,
      "NX",
    );
    const beforeQueries = state.queries;
    const held = await lease(
      "maintain-ttl",
      maintenance.TTL_LIMITS.ttlMs,
      maintenance.runTtlMaintenance,
    );
    leaseBlocked =
      !held.acquired &&
      state.queries === beforeQueries &&
      Object.values(rpcCalls).reduce((sum, n) => sum + n, 0) === 0;
    await redis.eval(
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
      1,
      "cron:maintain-ttl",
      "capacity-owner",
    );
    for (; tick < MAX_TICKS; tick++) {
      const start = START + tick * CADENCE_MS;
      if (clockMs > start)
        throw new Error("Modeled tick exceeds cadence; serial scheduling needs a separate model");
      clockMs = start;
      vi.setSystemTime(clockMs);
      const rpcBefore = Object.values(rpcCalls).reduce((sum, n) => sum + n, 0);
      const wallBefore = performance.now();
      const leased = await lease(
        "maintain-ttl",
        maintenance.TTL_LIMITS.ttlMs,
        maintenance.runTtlMaintenance,
      );
      wallDurations.push(performance.now() - wallBefore);
      if (!leased.acquired) throw new Error("Unexpected held lease in serial local run");
      const summary: TtlSummary = leased.value;
      durations.push(clockMs - start);
      maxAttempts = Math.max(maxAttempts, summary.submissions);
      maxRpcPerTick = Math.max(
        maxRpcPerTick,
        Object.values(rpcCalls).reduce((sum, n) => sum + n, 0) - rpcBefore,
      );
      exhaustedTicks += Number(summary.budgetExhausted);
      failedDeploymentAttempts += summary.failedDeployments.length;
      summary.details.forEach(updateCoverage);
      if (cycleServiced.size === entries.size && unresolvedPending.size === 0) {
        completedCycleTimesMs.push(clockMs - START);
        cycleServiced.clear();
      }
      if (firstInventoryMs === null && inspected.size === entries.size)
        firstInventoryMs = clockMs - START;
      if (
        firstMaintenanceMs === null &&
        serviced.size === entries.size &&
        unresolvedPending.size === 0
      )
        firstMaintenanceMs = clockMs - START;
      if (clockMs - START >= GATE_MS && gateSnapshot === null)
        gateSnapshot = {
          inspected: inspected.size,
          serviced: serviced.size,
          unresolved: entries.size - serviced.size,
        };
      if (
        completedCycleTimesMs.length >= (scenario.cycles ?? 1) ||
        (scenario.stopAtGate && clockMs - START >= GATE_MS)
      ) {
        tick++;
        break;
      }
    }
    const sorted = [...durations].sort((a, b) => a - b);
    const elapsedMs = clockMs - START;
    const unresolved = [...entries.values()].filter((entry) => !serviced.has(entry.target));
    const result = {
      ...scenario,
      cadenceMs: CADENCE_MS,
      gateMs: GATE_MS,
      ticks: tick,
      expectedTargets: entries.size,
      expectedInstances: [...entries.values()].filter((e) => e.kind === "instance").length,
      expectedCodeHashes: currentHashes.length + historicalHashes.length + 1,
      successfullyInspected: inspected.size,
      serviced: serviced.size,
      unresolved: unresolved.length,
      unresolvedPending: unresolvedPending.size,
      unresolvedByKind: {
        instance: unresolved.filter((e) => e.kind === "instance").length,
        code: unresolved.filter((e) => e.kind === "code").length,
      },
      fullInventoryMs: firstInventoryMs,
      fullMaintenanceMs: firstMaintenanceMs,
      completedCycleTimesMs,
      passesSixHourGate: firstMaintenanceMs !== null && firstMaintenanceMs <= GATE_MS,
      gateSnapshot,
      modeledElapsedMs: elapsedMs,
      rpcCalls,
      rpcRequests: Object.values(rpcCalls).reduce((sum, n) => sum + n, 0),
      maxRpcPerTick,
      meanModeledRpcRequestsPerSecond:
        Object.values(rpcCalls).reduce((sum, n) => sum + n, 0) / Math.max(1, elapsedMs / 1_000),
      realDatabaseQueries: state.queries - originalQueries,
      localWallMs: performance.now() - wallStart,
      localTickWallMaxMs: Math.max(...wallDurations),
      modeledTickMedianMs: sorted[Math.floor(sorted.length / 2)],
      modeledTickMaxMs: Math.max(...durations),
      modeledTicksOver30Seconds: durations.filter((ms) => ms > 30_000).length,
      passesThirtySecondResponseTarget: durations.every((ms) => ms <= 30_000),
      oldestSuccessfulInspectionAgeMs: Math.max(
        ...[...entries.values()].map((e) => clockMs - (lastInspected.get(e.target) ?? START)),
      ),
      oldestSuccessfulMaintenanceAgeMs: Math.max(
        ...[...entries.values()].map((e) => clockMs - (lastServiced.get(e.target) ?? START)),
      ),
      exhaustedTicks,
      failedDeploymentAttempts,
      statusCounts,
      syntheticSendCalls: sentTransactions.size,
      syntheticOperations: operations,
      syntheticDeclaredFeesStroops: simulatedFees.toString(),
      maximumSubmissionAttemptsPerTick: maxAttempts,
      maximumCodeReadCount: Math.max(
        ...[...entries.values()]
          .filter((e) => e.kind === "code")
          .map((e) => readsByTarget.get(e.target) ?? 0),
      ),
      heldLeaseBlocked: leaseBlocked,
      leaseReleased: (await redis.get("cron:maintain-ttl")) === null,
      externalHttpRequests: networkRequests,
      publicChainSubmissions: 0,
    };
    expect(networkRequests).toBe(0);
    expect(leaseBlocked).toBe(true);
    expect(result.leaseReleased).toBe(true);
    expect(result.maximumSubmissionAttemptsPerTick).toBeLessThanOrEqual(
      maintenance.TTL_LIMITS.maxSubmissions,
    );
    expect(result.successfullyInspected).toBeLessThanOrEqual(result.expectedTargets);
    expect(result.serviced).toBeLessThanOrEqual(result.expectedTargets);
    if (!scenario.paid) expect(result.syntheticSendCalls).toBe(0);
    expect(new Set([...sentTransactions.values()].map((tx) => tx.target)).size).toBe(
      sentTransactions.size,
    );
    if (scenario.name === "healthy-100x3" || scenario.name === "healthy-100x10")
      expect(result.passesSixHourGate).toBe(true);
    if (["healthy-growth-700x10", "slow-100x10"].includes(scenario.name))
      expect(result.passesSixHourGate).toBe(true);
    expect(result.passesThirtySecondResponseTarget).toBe(true);
    if (scenario.fault === "uncertain") {
      expect(result.syntheticSendCalls).toBe(1);
      expect(result.unresolvedPending).toBe(1);
      expect(result.passesSixHourGate).toBe(false);
    }
    if (
      ["persistent-read", "missing", "fee-cap"].includes(scenario.fault ?? "") &&
      !scenario.recoverAfterTicks
    )
      expect(result.passesSixHourGate).toBe(false);
    if (["persistent-read", "missing"].includes(scenario.fault ?? ""))
      expect(result.unresolved).toBe(affected.size);
    if (!scenario.fault || scenario.fault === "transient-read" || scenario.recoverAfterTicks)
      expect(result.fullMaintenanceMs).not.toBeNull();
    if (scenario.cycles) expect(completedCycleTimesMs).toHaveLength(scenario.cycles);
    const auditCount = await db.auditLog.count({
      where: { action: { in: ["CONTRACT_STORAGE_EXTENDED", "CONTRACT_STORAGE_RESTORED"] } },
    });
    expect(auditCount).toBe((statusCounts.extended ?? 0) + (statusCounts.restored ?? 0));
    const pendingAuditRows = await db.auditLog.count({
      where: { action: "CONTRACT_STORAGE_RENT_PENDING" },
    });
    expect(pendingAuditRows).toBe(statusCounts.pending ?? 0);
    return { ...result, maintenanceAuditRows: auditCount, pendingAuditRows };
  } finally {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  }
}

it.each(scenarios)("measures $name with real PostgreSQL and Redis", async (scenario) => {
  results.push(await runScenario(scenario));
});

it("writes the public local evidence without credentials or simulated transaction envelopes", async () => {
  expect(results).toHaveLength(scenarios.length);
  const evidence = {
    environment: "isolated-local-postgres-redis-synthetic-rpc",
    measuredAt: new Date().toISOString(),
    actualRunner: "lib/stellar/ttl-maintenance.ts",
    baselineEvidence: "docs/evidence/ttl-capacity-local.json",
    actualLease: "lib/cron/lease.ts",
    limits: maintenance.TTL_LIMITS,
    runtimeSourceSha256: Object.fromEntries(
      await Promise.all(
        ["lib/stellar/ttl-maintenance.ts", "lib/cron/lease.ts", "lib/stellar/ttl-deadline.ts"].map(
          async (path) => [
            path,
            createHash("sha256")
              .update(await readFile(path))
              .digest("hex"),
          ],
        ),
      ),
    ),
    assumptions: {
      rpcTiming:
        "Injected virtual Date; RPC method costs are scenario inputs, not measured provider timings.",
      databaseTiming:
        "Real queries/leases execute in wall time; wall time is recorded separately and excluded from modeled cycle times.",
      ledgerMs: 5_000,
      finality:
        "A synthetic getTransaction waits until the specified confirmation time, bounded by remaining run time. Timed-out known synthetic sends confirm in the synthetic source barrier on later acquisition; lost sends stay blocked indefinitely. Inventory reflects confirmation independently of source acquisition. This models the new read timeout, not real channel reconciliation.",
      fees: "Synthetic 40,000-stroop resource fee plus base fee; rejected resource fee 1,000,001. Not rent measurements or operating-cost estimates.",
      fixture:
        "Synthetic confirmed snapshots; graph compilation, factory deployment, wallet signing, real archive metadata and provider throughput are not exercised.",
      cadence:
        "Serial calls start one minute apart in virtual time; no recurring scheduler is installed.",
      coverage:
        "Gate requires every expected instance/code target healthy or confirmed serviced; missing, failed, deferred and pending targets cannot pass.",
      exclusions:
        "Each scenario includes confirmed sandbox, failed testnet and confirmed mainnet rows; unexpected target reads fail the rehearsal.",
    },
    externalHttpRequests: 0,
    publicChainSubmissions: 0,
    scenarios: results,
  };
  await writeFile(
    "docs/evidence/ttl-capacity-optimized-local.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
});
