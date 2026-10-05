import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Address, Keypair } from "@stellar/stellar-sdk";
import type { TtlRecoveryReport } from "@/lib/stellar/ttl-recovery";
import type { TtlFixtureTransactionObserver } from "@/lib/stellar/ttl-rehearsal";

const { instances, balances, escrow, previous, measure } = vi.hoisted(() => ({
  instances: vi.fn(),
  balances: vi.fn(),
  escrow: vi.fn(),
  previous: vi.fn(),
  measure: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { transactionFeeReservation: { findFirst: previous } } }));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => ({}) }));
vi.mock("@/lib/stellar/ttl-fee-measurements", () => ({ measureSorobanTransactionFee: measure }));
vi.mock("@/lib/stellar/ttl-rehearsal", async (original) => ({
  ...(await original<typeof import("@/lib/stellar/ttl-rehearsal")>()),
  readTtlFixtureInstances: instances,
  readTtlFixtureTokenBalances: balances,
  submitTtlFixtureEscrow: escrow,
}));

const relayer = Keypair.random().publicKey();
const recipient = Keypair.random().publicKey();
const webhook = Address.contract(Buffer.alloc(32, 1)).toString();
const pay = Address.contract(Buffer.alloc(32, 2)).toString();
const record = {
  hash: "ab".repeat(32),
  payer: relayer,
  declaredFeeStroops: "120",
  purpose: "fixture-payment" as const,
};
const outcome = { ...record, status: "SUCCESS" as const, netFeeStroops: "100", ledger: 202 };
const feeDetails = {
  hash: record.hash,
  ledger: 202,
  payer: relayer,
  operation: "invokeHostFunction",
  declaredFeeStroops: "120",
  initiallyChargedStroops: "120",
  refundStroops: "20",
  netFeeStroops: "100",
  resultFeeChargedStroops: "100",
  rentFeeStroops: "0",
  feeEvents: [],
};
const beforeBalances = { [webhook]: "10000000", [pay]: "0", [recipient]: "9007199254740993" };
const afterBalances = { [webhook]: "0", [pay]: "0", [recipient]: "9007199264740993" };
let fixture: Record<string, unknown>;
let before: Array<{
  address: string;
  latestLedger: number;
  liveUntilLedger: number;
  valueSha256: string;
  wasmHash: string;
}>;
let saved: TtlRecoveryReport[];
const save = async (report: TtlRecoveryReport) => {
  saved.push(structuredClone(report));
};

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  Object.assign(process.env, {
    RAILWAY_ENVIRONMENT_NAME: "hackathon-testing",
    STELLAR_NETWORK: "testnet",
    STELLAR_TTL_MAX_FEE_STROOPS: "500000000",
    STELLAR_TTL_FEE_BUDGET_NAME: "ttl804-testnet-20261004",
    STELLAR_TTL_FEE_BUDGET_STROOPS: "1500000000",
    STELLAR_RELAYER_ADDRESS: relayer,
  });
  const { TTL_REHEARSAL } = await import("@/lib/stellar/ttl-rehearsal");
  before = [
    {
      address: webhook,
      latestLedger: 200,
      liveUntilLedger: 100,
      valueSha256: "12".repeat(32),
      wasmHash: TTL_REHEARSAL.wasm.WEBHOOK,
    },
    {
      address: pay,
      latestLedger: 200,
      liveUntilLedger: 100,
      valueSha256: "34".repeat(32),
      wasmHash: TTL_REHEARSAL.wasm.PAYER,
    },
  ];
  fixture = {
    environment: "hackathon-testing",
    network: "TESTNET",
    phase: "awaiting-natural-expiry",
    budget: TTL_REHEARSAL.budget,
    admin: relayer,
    recipient,
    relayer,
    registeredForMaintenance: false,
    pipeline: [
      { nodeId: "webhook", templateKind: "WEBHOOK", contractAddress: webhook },
      { nodeId: "pay", templateKind: "PAYER", contractAddress: pay },
    ],
    instances: before,
  };
  instances
    .mockResolvedValueOnce(before)
    .mockResolvedValue(before.map((row) => ({ ...row, latestLedger: 202, liveUntilLedger: 1000 })));
  balances.mockResolvedValueOnce(beforeBalances).mockResolvedValue(afterBalances);
  previous.mockResolvedValue(null);
  measure.mockResolvedValue(feeDetails);
  escrow.mockImplementation(async (_address: string, observer: TtlFixtureTransactionObserver) => {
    await observer.beforeSend(record);
    await observer.onFinality(outcome);
    return { ...outcome, fees: feeDetails };
  });
  saved = [];
});
afterEach(() => {
  for (const key of [
    "RAILWAY_ENVIRONMENT_NAME",
    "STELLAR_NETWORK",
    "STELLAR_TTL_MAX_FEE_STROOPS",
    "STELLAR_TTL_FEE_BUDGET_NAME",
    "STELLAR_TTL_FEE_BUDGET_STROOPS",
    "STELLAR_RELAYER_ADDRESS",
  ])
    delete process.env[key];
});

it.each(["instances", "balances", "validation"])(
  "persists confirmed payment before %s verification fails",
  async (failure) => {
    if (failure === "instances")
      instances
        .mockReset()
        .mockResolvedValueOnce(before)
        .mockRejectedValueOnce(new Error("RPC down"));
    if (failure === "balances")
      balances
        .mockReset()
        .mockResolvedValueOnce(beforeBalances)
        .mockRejectedValueOnce(new Error("RPC down"));
    if (failure === "validation")
      balances
        .mockReset()
        .mockResolvedValueOnce(beforeBalances)
        .mockResolvedValueOnce({ ...afterBalances, [pay]: "1" });
    const { recoverTtlFixture } = await import("@/lib/stellar/ttl-recovery");
    await expect(recoverTtlFixture(fixture, true, save)).rejects.toThrow();
    const confirmed = saved.find((row) => row.phase === "payment-confirmed-awaiting-verification");
    expect(confirmed?.transactions[0]).toMatchObject(outcome);
    expect(confirmed?.networkSubmissions).toBe(1);
    expect(saved.at(-1)).toMatchObject({
      phase: "payment-confirmed-verification-failed",
      networkSubmissions: 1,
      verification: "failed",
    });
    expect(saved.at(-1)?.transactions[0]).toMatchObject(outcome);
    expect(escrow).toHaveBeenCalledOnce();
  },
);
it("counts and retains a separate restoration followed by payment", async () => {
  const restored = { ...outcome, hash: "cd".repeat(32), purpose: "ttl-restoration" as const };
  escrow.mockImplementation(async (_address: string, observer: TtlFixtureTransactionObserver) => {
    await observer.beforeSend(restored);
    await observer.onFinality(restored);
    await observer.beforeSend(record);
    await observer.onFinality(outcome);
    return { ...outcome, fees: feeDetails };
  });
  const { recoverTtlFixture } = await import("@/lib/stellar/ttl-recovery");
  const result = await recoverTtlFixture(fixture, true, save);
  expect(result).toMatchObject({
    networkSubmissions: 2,
    confirmedTransactions: 2,
    verification: "passed",
  });
  expect(result.transactions.map((row) => row.hash)).toEqual([restored.hash, outcome.hash]);
  expect(saved.find((row) => row.phase === "restoration-confirmed")?.transactions[0]).toMatchObject(
    restored,
  );
  expect(measure).toHaveBeenCalledWith({}, restored.hash, expect.any(String));
});
it("retains restoration success and payment uncertainty without claiming zero submissions", async () => {
  escrow.mockImplementation(async (_address: string, observer: TtlFixtureTransactionObserver) => {
    const restored = { ...outcome, hash: "cd".repeat(32), purpose: "ttl-restoration" as const };
    await observer.beforeSend(restored);
    await observer.onFinality(restored);
    await observer.beforeSend(record);
    throw new Error("Transport failure");
  });
  const { recoverTtlFixture } = await import("@/lib/stellar/ttl-recovery");
  await expect(recoverTtlFixture(fixture, true, save)).rejects.toThrow("Transport");
  expect(saved.at(-1)).toMatchObject({ networkSubmissions: null, confirmedTransactions: 1 });
  expect(saved.at(-1)?.transactions.map((row) => row.status)).toEqual(["SUCCESS", "RESERVED"]);
});
it("retains payment finality if fee metadata measurement fails", async () => {
  escrow.mockImplementation(async (_address: string, observer: TtlFixtureTransactionObserver) => {
    await observer.beforeSend(record);
    await observer.onFinality(outcome);
    throw new Error("Fee metadata unavailable");
  });
  const { recoverTtlFixture } = await import("@/lib/stellar/ttl-recovery");
  await expect(recoverTtlFixture(fixture, true, save)).rejects.toThrow("Fee metadata");
  expect(saved.at(-1)?.transactions[0]).toMatchObject(outcome);
  expect(saved.at(-1)?.networkSubmissions).toBe(1);
});
it("records failed payment finality without reporting success", async () => {
  escrow.mockImplementation(async (_address: string, observer: TtlFixtureTransactionObserver) => {
    await observer.beforeSend(record);
    await observer.onFinality({ ...outcome, status: "FAILED" });
    throw new Error("Payment failed");
  });
  const { recoverTtlFixture } = await import("@/lib/stellar/ttl-recovery");
  await expect(recoverTtlFixture(fixture, true, save)).rejects.toThrow("Payment failed");
  expect(saved.at(-1)).toMatchObject({
    phase: "payment-failed",
    networkSubmissions: 1,
    verification: "not-started",
  });
});
it("refuses previously reserved payment before any invocation", async () => {
  previous.mockResolvedValue({ txHash: outcome.hash });
  const { recoverTtlFixture } = await import("@/lib/stellar/ttl-recovery");
  await expect(recoverTtlFixture(fixture, true, save)).rejects.toThrow("already reserved");
  expect(escrow).not.toHaveBeenCalled();
});
it.each([false, true])(
  "performs no transaction before genuine expiry (execute=%s)",
  async (execute) => {
    instances
      .mockReset()
      .mockResolvedValue(before.map((row) => ({ ...row, liveUntilLedger: 1000 })));
    const { recoverTtlFixture } = await import("@/lib/stellar/ttl-recovery");
    const result = await recoverTtlFixture(fixture, execute, save);
    expect(result).toMatchObject({ phase: "awaiting-natural-expiry", networkSubmissions: 0 });
    expect(escrow).not.toHaveBeenCalled();
  },
);
