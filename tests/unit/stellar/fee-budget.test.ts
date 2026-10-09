import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { Prisma } from "@prisma/client";

const { tx, transaction } = vi.hoisted(() => ({
  tx: {
    transactionFeeBudget: { upsert: vi.fn(), updateMany: vi.fn() },
    transactionFeeReservation: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { $transaction: transaction } }));

const input = {
  network: "testnet" as const,
  budget: { name: "ttl804-test", limitStroops: "1500000000" },
  txHash: "ab".repeat(32),
  payer: Keypair.random().publicKey(),
  declaredFeeStroops: "500000000",
  purpose: "fixture-setup" as const,
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  tx.transactionFeeBudget.upsert.mockResolvedValue({
    limitStroops: "1500000000",
    committedStroops: "1000000000",
  });
  tx.transactionFeeBudget.updateMany.mockResolvedValue({ count: 1 });
  tx.transactionFeeReservation.create.mockResolvedValue({});
  tx.auditLog.create.mockResolvedValue({});
  transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<void>) => fn(tx));
});
afterEach(() => {
  delete process.env.STELLAR_TTL_FEE_BUDGET_NAME;
  delete process.env.STELLAR_TTL_FEE_BUDGET_STROOPS;
});

describe("fee budget boundary", () => {
  it("permits the old cap without a campaign, but refuses a raised cap without a durable budget", async () => {
    const { ttlFeeBudget } = await import("@/lib/stellar/fee-budget");
    expect(ttlFeeBudget("1000000")).toBeUndefined();
    expect(() => ttlFeeBudget("1000001")).toThrow("cumulative fee budget");
  });
  it("loads the explicitly configured fixed ceiling", async () => {
    process.env.STELLAR_TTL_FEE_BUDGET_NAME = input.budget.name;
    process.env.STELLAR_TTL_FEE_BUDGET_STROOPS = input.budget.limitStroops;
    const { ttlFeeBudget } = await import("@/lib/stellar/fee-budget");
    expect(ttlFeeBudget("500000000")).toEqual(input.budget);
  });
  it.each(["0", "-1", "1.5", "1e7", "01", " 10", "90071992547409930000"])(
    "rejects an invalid declared fee %s before DB work",
    async (fee) => {
      const { reserveTransactionFee } = await import("@/lib/stellar/fee-budget");
      await expect(reserveTransactionFee({ ...input, declaredFeeStroops: fee })).rejects.toThrow();
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it.each([
    { txHash: "bad" },
    { payer: "bad" },
    { network: "mainnet" },
    { budget: { name: "../reset", limitStroops: "1500000000" } },
    { budget: { name: input.budget.name, limitStroops: "0" } },
  ])("rejects adversarial reservation %j before DB work", async (override) => {
    const { reserveTransactionFee } = await import("@/lib/stellar/fee-budget");
    await expect(
      reserveTransactionFee({ ...input, ...override } as typeof input),
    ).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("durable reservations", () => {
  it("admits exact ceiling with string arithmetic and a compare-and-set", async () => {
    const { reserveTransactionFee } = await import("@/lib/stellar/fee-budget");
    await reserveTransactionFee(input);
    expect(tx.transactionFeeBudget.updateMany).toHaveBeenCalledWith({
      where: { network: "testnet", name: input.budget.name, committedStroops: "1000000000" },
      data: { committedStroops: "1500000000" },
    });
    expect(tx.transactionFeeReservation.create).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });
  it("rejects one stroop over the ceiling without updating or reserving", async () => {
    const { reserveTransactionFee } = await import("@/lib/stellar/fee-budget");
    await expect(
      reserveTransactionFee({ ...input, declaredFeeStroops: "500000001" }),
    ).rejects.toThrow("exhausted");
    expect(tx.transactionFeeBudget.updateMany).not.toHaveBeenCalled();
    expect(tx.transactionFeeReservation.create).not.toHaveBeenCalled();
  });
  it("rejects a changed campaign limit rather than resetting accumulated commitments", async () => {
    const { reserveTransactionFee } = await import("@/lib/stellar/fee-budget");
    await expect(
      reserveTransactionFee({ ...input, budget: { ...input.budget, limitStroops: "1600000000" } }),
    ).rejects.toThrow("durable approval");
    expect(tx.transactionFeeBudget.updateMany).not.toHaveBeenCalled();
  });
  it("rereads after a competing reservation and rejects when it consumed the remaining budget", async () => {
    tx.transactionFeeBudget.updateMany.mockResolvedValueOnce({ count: 0 });
    tx.transactionFeeBudget.upsert
      .mockResolvedValueOnce({ limitStroops: "1500000000", committedStroops: "1000000000" })
      .mockResolvedValueOnce({ limitStroops: "1500000000", committedStroops: "1500000000" });
    const { reserveTransactionFee } = await import("@/lib/stellar/fee-budget");
    await expect(reserveTransactionFee(input)).rejects.toThrow("exhausted");
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(tx.transactionFeeReservation.create).not.toHaveBeenCalled();
  });
  it("bounds conflict retries and never creates a reservation after failed compare-and-set", async () => {
    tx.transactionFeeBudget.updateMany.mockResolvedValue({ count: 0 });
    const { reserveTransactionFee } = await import("@/lib/stellar/fee-budget");
    await expect(reserveTransactionFee(input)).rejects.toThrow("busy");
    expect(transaction).toHaveBeenCalledTimes(5);
    expect(tx.transactionFeeReservation.create).not.toHaveBeenCalled();
  });
  it("fails closed on duplicate hashes and unavailable persistence", async () => {
    tx.transactionFeeReservation.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    const { reserveTransactionFee } = await import("@/lib/stellar/fee-budget");
    await expect(reserveTransactionFee(input)).rejects.toThrow("already reserved");
    transaction.mockRejectedValueOnce(new Error("offline"));
    await expect(reserveTransactionFee(input)).rejects.toThrow("offline");
  });
});

describe("permanent fixture setup claims", () => {
  it("claims an approved campaign atomically without reserving a fee", async () => {
    const { claimFixtureSetup } = await import("@/lib/stellar/fee-budget");
    await claimFixtureSetup(input.budget);
    expect(tx.transactionFeeBudget.updateMany).toHaveBeenCalledWith({
      where: {
        network: "testnet",
        name: input.budget.name,
        limitStroops: input.budget.limitStroops,
        fixtureSetupClaimedAt: null,
        reservations: { none: { purpose: { in: ["fixture-setup", "fixture-deposit"] } } },
      },
      data: { fixtureSetupClaimedAt: expect.any(Date) },
    });
    expect(tx.transactionFeeBudget.upsert).not.toHaveBeenCalled();
    expect(tx.transactionFeeReservation.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: "TTL_FIXTURE_SETUP_CLAIMED",
        metadata: { network: "testnet", budgetName: input.budget.name },
      },
    });
  });
  it("refuses an already claimed, previously reserved, missing or changed-limit approval", async () => {
    tx.transactionFeeBudget.updateMany.mockResolvedValue({ count: 0 });
    const { claimFixtureSetup } = await import("@/lib/stellar/fee-budget");
    await expect(claimFixtureSetup(input.budget)).rejects.toThrow("already claimed");
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it("fails closed if the atomic audit transaction cannot complete", async () => {
    tx.auditLog.create.mockRejectedValueOnce(new Error("audit unavailable"));
    const { claimFixtureSetup } = await import("@/lib/stellar/fee-budget");
    await expect(claimFixtureSetup(input.budget)).rejects.toThrow("audit unavailable");
    expect(transaction).toHaveBeenCalledOnce();
  });
  it("rejects malformed campaign approval before database access", async () => {
    const { claimFixtureSetup } = await import("@/lib/stellar/fee-budget");
    await expect(claimFixtureSetup({ ...input.budget, name: "../reset" })).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
});
