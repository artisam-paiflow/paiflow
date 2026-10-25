import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { db, getTransaction, record, confirm } = vi.hoisted(() => ({
  db: {
    signedTransaction: { findMany: vi.fn(), updateMany: vi.fn() },
    deployment: { updateMany: vi.fn() },
  },
  getTransaction: vi.fn(),
  record: vi.fn(async () => true),
  confirm: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => ({ getTransaction }) }));
vi.mock("@/lib/stellar/deploy", () => ({ extractCreatedContract: () => "C-created" }));
vi.mock("@/lib/analytics/outcomes", () => ({ recordTransactionOutcome: record }));
vi.mock("@/lib/deployments/confirm", () => ({ confirmDeployment: confirm }));
import { reconcileTransactions } from "@/lib/stellar/reconcile-transactions";
const row = {
  id: "id",
  trackingVersion: "usage-v2",
  txHash: "a".repeat(64),
  outcome: "ACCEPTED",
  kind: "TRIGGER",
  network: "testnet",
  nextCheckAt: new Date(),
  createdAt: new Date(),
  signerAddress: "G-source",
  checkAttempts: 0,
  submissionRevision: 1,
  outcomeRevision: 1,
  deployment: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  db.signedTransaction.findMany.mockResolvedValue([row]);
  db.signedTransaction.updateMany.mockResolvedValue({ count: 1 });
  db.deployment.updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.useRealTimers());
describe("bounded server reconciliation", () => {
  it.each([0, 1, 3, 7])(
    "checks a recent deployment on the next minute tick after %s missing reads",
    async (checkAttempts) => {
      const now = new Date();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now);
      db.signedTransaction.findMany.mockResolvedValue([
        { ...row, kind: "DEPLOY", createdAt: new Date(now.getTime() - 5 * 60_000), checkAttempts },
      ]);
      getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
      await reconcileTransactions();
      expect(db.signedTransaction.updateMany).toHaveBeenLastCalledWith({
        where: { id: row.id, outcome: "UNRESOLVED", submissionRevision: 1, outcomeRevision: 2 },
        data: { nextCheckAt: new Date(now.getTime() + 60_000) },
      });
    },
  );
  it.each(["DEPLOY", "TRIGGER"])(
    "retains long-term backoff for older %s attempts without clearing unknown finality",
    async (kind) => {
      const now = new Date();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now);
      db.signedTransaction.findMany.mockResolvedValue([
        { ...row, kind, createdAt: new Date(now.getTime() - 15 * 60_000), checkAttempts: 4 },
      ]);
      getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
      await reconcileTransactions();
      expect(record).toHaveBeenCalledWith(row.txHash, "UNRESOLVED", expect.any(Object));
      expect(db.signedTransaction.updateMany).toHaveBeenLastCalledWith({
        where: { id: row.id, outcome: "UNRESOLVED", submissionRevision: 1, outcomeRevision: 2 },
        data: { nextCheckAt: new Date(now.getTime() + 480_000) },
      });
    },
  );
  it.each(["NOT_FOUND", "RPC_UNAVAILABLE"])(
    "preserves a known RPC rejection on %s without a resend",
    async (result) => {
      db.signedTransaction.findMany.mockResolvedValue([
        { ...row, outcome: "REJECTED", failureCode: "RPC_REJECTED" },
      ]);
      if (result === "NOT_FOUND") getTransaction.mockResolvedValue({ status: result });
      else getTransaction.mockRejectedValue(new Error("read unavailable"));
      expect(await reconcileTransactions()).toMatchObject({
        checked: 1,
        confirmed: 0,
        failed: 0,
        unresolved: 0,
      });
      expect(record).not.toHaveBeenCalled();
    },
  );
  it.each(["SUCCESS", "FAILED"])(
    "can finalize a rejected hash with verified %s",
    async (status) => {
      db.signedTransaction.findMany.mockResolvedValue([{ ...row, outcome: "REJECTED" }]);
      getTransaction.mockResolvedValue({ status, ledger: 123 });
      await reconcileTransactions();
      expect(record).toHaveBeenCalledWith(
        row.txHash,
        status === "SUCCESS" ? "CONFIRMED" : "FAILED",
        status === "SUCCESS" ? { ledger: 123 } : { ledger: 123, failureCode: "ONCHAIN_FAILED" },
      );
    },
  );
  it("confirms abandoned executions using RPC finality", async () => {
    getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 123 });
    expect(await reconcileTransactions()).toMatchObject({ checked: 1, confirmed: 1 });
    expect(record).toHaveBeenCalledWith(row.txHash, "CONFIRMED", { ledger: 123 });
    expect(db.signedTransaction.findMany.mock.calls[0]?.[0].where).toMatchObject({
      trackingVersion: "usage-v2",
      network: "testnet",
    });
  });
  it("leaves NOT_FOUND unresolved, even after the retention horizon", async () => {
    db.signedTransaction.findMany.mockResolvedValue([
      { ...row, createdAt: new Date(Date.now() - 7 * 24 * 3600_000) },
    ]);
    getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
    await reconcileTransactions();
    expect(record).toHaveBeenCalledWith(row.txHash, "UNRESOLVED", {
      failureCode: "FINALITY_UNKNOWN",
      observation: { submissionRevision: 1, outcomeRevision: 1 },
    });
    expect(db.signedTransaction.updateMany).toHaveBeenLastCalledWith({
      where: { id: row.id, outcome: "UNRESOLVED", submissionRevision: 1, outcomeRevision: 2 },
      data: { nextCheckAt: null },
    });
  });
  it("distinguishes RPC errors from verified failure", async () => {
    getTransaction.mockRejectedValue(new Error("RPC unavailable"));
    await reconcileTransactions();
    expect(record).toHaveBeenCalledWith(row.txHash, "UNRESOLVED", {
      failureCode: "RPC_UNAVAILABLE",
      observation: { submissionRevision: 1, outcomeRevision: 1 },
    });
    getTransaction.mockResolvedValue({ status: "FAILED", ledger: 789 });
    await reconcileTransactions();
    expect(record).toHaveBeenLastCalledWith(row.txHash, "FAILED", {
      ledger: 789,
      failureCode: "ONCHAIN_FAILED",
    });
  });
  it("skips an expired concurrent claim and honors the work budget", async () => {
    db.signedTransaction.updateMany.mockResolvedValue({ count: 0 });
    expect(await reconcileTransactions()).toMatchObject({ checked: 0 });
    expect(getTransaction).not.toHaveBeenCalled();
    expect(await reconcileTransactions({ budgetMs: 0 })).toMatchObject({
      checked: 0,
      truncated: true,
    });
  });
  it("runs deployment setup before committing confirmation bookkeeping", async () => {
    const deployment = { id: "deployment", status: "SUBMITTED", deployTxHash: row.txHash };
    db.signedTransaction.findMany.mockResolvedValue([{ ...row, kind: "DEPLOY", deployment }]);
    getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 123 });
    await reconcileTransactions();
    expect(confirm).toHaveBeenCalledWith(
      deployment,
      { txHash: row.txHash, contractAddress: "C-created" },
      row.signerAddress,
      true,
    );
    expect(confirm.mock.invocationCallOrder[0]).toBeLessThan(record.mock.invocationCallOrder[0]!);
  });
});
