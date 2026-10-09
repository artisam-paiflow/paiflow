import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  invalidate: vi.fn(),
  commit: true,
  row: {} as Record<string, unknown>,
  update: vi.fn(async () => ({ count: 1 })),
}));
vi.mock("@/lib/stellar/dashboard-balance-cache", () => ({
  invalidateDashboardBalances: state.invalidate,
}));
vi.mock("@/lib/analytics/outbox", () => ({ enqueueAnalytics: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const result = await fn({
        signedTransaction: { findUnique: async () => state.row, updateMany: state.update },
        deployment: { findUnique: async () => ({ flowId: "f" }) },
      });
      expect(state.invalidate).not.toHaveBeenCalled();
      if (!state.commit) throw new Error("commit failed");
      return result;
    },
  },
}));
import { recordTransactionOutcome } from "@/lib/analytics/outcomes";
import { TRACKING_VERSION } from "@/lib/analytics/policy";
beforeEach(() => {
  state.invalidate.mockClear();
  state.commit = true;
  state.update.mockClear();
  state.row = {
    id: "s",
    txHash: "tx",
    outcome: "ACCEPTED",
    trackingVersion: TRACKING_VERSION,
    network: "testnet",
    deploymentId: "d",
    kind: "INVOKE",
    outcomeRevision: 1,
    submissionRevision: 1,
    signerAddress: "wallet",
  };
});
it("invalidates once after a committed, deployment-bound confirmation", async () => {
  expect(await recordTransactionOutcome("tx", "CONFIRMED", { deploymentId: "d" })).toBe(true);
  expect(state.invalidate).toHaveBeenCalledExactlyOnceWith("d", "tx");
});
it("does not invalidate on a failed commit, failed transaction, replay or wrong deployment", async () => {
  state.commit = false;
  expect(await recordTransactionOutcome("tx", "CONFIRMED")).toBe(false);
  expect(state.invalidate).not.toHaveBeenCalled();
  state.commit = true;
  await recordTransactionOutcome("tx", "FAILED");
  expect(state.invalidate).not.toHaveBeenCalled();
  state.row.outcome = "CONFIRMED";
  await recordTransactionOutcome("tx", "CONFIRMED");
  expect(state.invalidate).not.toHaveBeenCalled();
  state.row.outcome = "ACCEPTED";
  await recordTransactionOutcome("tx", "CONFIRMED", { deploymentId: "other" });
  expect(state.invalidate).not.toHaveBeenCalled();
});
