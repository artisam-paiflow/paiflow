import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc } = vi.hoisted(() => ({
  rpc: { getTransaction: vi.fn(), getLatestLedger: vi.fn(), getLedgers: vi.fn() },
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => rpc }));
import { payoutTransactionFinished } from "@/lib/stellar/payout-state";
const tx = { txHash: "a".repeat(64), maxTime: "1000" };
beforeEach(() => {
  vi.resetAllMocks();
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
      rpc.getLedgers.mockResolvedValue({ ledgers: [{ sequence: 42, ledgerCloseTime: close }] });
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
  it.each([
    "",
    "no-time",
    "1.5",
    "-1",
    "18446744073709551616",
    undefined,
    null,
    1001,
    9007199254740993,
  ])("refuses malformed ledger close time %s", async (ledgerCloseTime) => {
    rpc.getLedgers.mockResolvedValue({ ledgers: [{ sequence: 42, ledgerCloseTime }] });
    await expect(payoutTransactionFinished(tx)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
  });
  it.each([undefined, "42", -1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x1_0000_0000])(
    "refuses malformed latest-ledger sequence %s",
    async (sequence) => {
      rpc.getLatestLedger.mockResolvedValue({ sequence });
      await expect(payoutTransactionFinished(tx)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
      expect(rpc.getLedgers).not.toHaveBeenCalled();
    },
  );
  it.each(["getLatestLedger", "getLedgers"] as const)(
    "retains protection on %s failure",
    async (method) => {
      rpc[method].mockRejectedValue(new Error("timeout"));
      await expect(payoutTransactionFinished(tx)).rejects.toThrow(/protection is retained/);
    },
  );
  it("keeps an unknown transaction protected regardless of the wall clock", async () => {
    rpc.getLedgers.mockResolvedValue({ ledgers: [{ sequence: 42, ledgerCloseTime: "999" }] });
    const clock = vi.spyOn(Date, "now").mockReturnValue(2_000_000_000_000);
    try {
      expect(await payoutTransactionFinished(tx)).toBe(false);
      expect(clock).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });
  it.each([undefined, "PENDING", "garbage"])(
    "retains protection on malformed transaction status %s",
    async (status) => {
      rpc.getTransaction.mockResolvedValue({ status });
      await expect(payoutTransactionFinished(tx)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
      expect(rpc.getLatestLedger).not.toHaveBeenCalled();
    },
  );
  it.each([undefined, "42", 41, 43])(
    "refuses a mismatched ledger sequence %s",
    async (sequence) => {
      rpc.getLedgers.mockResolvedValue({ ledgers: [{ sequence, ledgerCloseTime: "1001" }] });
      await expect(payoutTransactionFinished(tx)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    },
  );
});
