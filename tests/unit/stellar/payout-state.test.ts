import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc } = vi.hoisted(() => ({
  rpc: { getTransaction: vi.fn(), getLatestLedger: vi.fn(), getLedgers: vi.fn() },
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => rpc }));
import { payoutTransactionFinished } from "@/lib/stellar/payout-state";
const tx = { txHash: "a".repeat(64), maxTime: "1000" };
beforeEach(() => {
  vi.clearAllMocks();
  rpc.getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
  rpc.getLatestLedger.mockResolvedValue({ sequence: 42 });
});
describe("payout finality proof", () => {
  it.each(["SUCCESS", "FAILED"])(
    "accepts confirmed %s without consulting wall clocks",
    async (status) => {
      rpc.getTransaction.mockResolvedValue({ status });
      expect(await payoutTransactionFinished(tx)).toBe(true);
      expect(rpc.getLatestLedger).not.toHaveBeenCalled();
    },
  );
  it.each(["999", "1000", "1001"])(
    "uses a closed ledger time %s against maxTime",
    async (close) => {
      rpc.getLedgers.mockResolvedValue({ ledgers: [{ ledgerCloseTime: close }] });
      expect(await payoutTransactionFinished(tx)).toBe(close === "1001");
      expect(rpc.getLedgers).toHaveBeenCalledWith({ startLedger: 42, pagination: { limit: 1 } });
    },
  );
  it("refuses missing or untrustworthy ledger time", async () => {
    rpc.getLedgers.mockResolvedValue({ ledgers: [] });
    await expect(payoutTransactionFinished(tx)).rejects.toThrow(/ledger-time/);
  });
  it("never releases on RPC failure", async () => {
    rpc.getTransaction.mockRejectedValue(new Error("timeout"));
    await expect(payoutTransactionFinished(tx)).rejects.toThrow(/protection is retained/);
  });
});
