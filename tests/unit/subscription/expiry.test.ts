import { beforeEach, describe, expect, it, vi } from "vitest";
const server = vi.hoisted(() => ({
  getTransaction: vi.fn(),
  getLatestLedger: vi.fn(),
  getLedgers: vi.fn(),
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => server }));
import { allowanceHasExpired } from "@/lib/stellar/allowance-status";
const tx = { txHash: "a".repeat(64), maxTime: "1000", preparationLedger: 90 };
const notFound = {
  status: "NOT_FOUND",
  latestLedger: 100,
  latestLedgerCloseTime: "1001",
  oldestLedger: 80,
  oldestLedgerCloseTime: "800",
};
beforeEach(() => {
  vi.resetAllMocks();
  server.getTransaction.mockResolvedValue(notFound);
  server.getLatestLedger.mockResolvedValue({ sequence: 100 });
  server.getLedgers.mockResolvedValue({ ledgers: [{ sequence: 100, ledgerCloseTime: "1001" }] });
});
describe("uncertain allowance expiration", () => {
  it("permits another approval only after ledger-time expiry and a final NOT_FOUND read", async () => {
    expect(await allowanceHasExpired(tx)).toBe(true);
    expect(server.getTransaction).toHaveBeenCalledTimes(2);
  });
  it.each([
    { latestLedger: 89, latestLedgerCloseTime: "990" },
    { latestLedger: 99 },
    { latestLedgerCloseTime: "1000" },
    { oldestLedger: 91 },
    { oldestLedger: 101, oldestLedgerCloseTime: "1002" },
    { oldestLedgerCloseTime: "1500000" },
    { latestLedger: undefined },
    { oldestLedger: undefined },
    { latestLedger: 100.5 },
    { oldestLedger: 0 },
    { latestLedgerCloseTime: undefined },
    { latestLedgerCloseTime: 1001 },
    { oldestLedgerCloseTime: "bad" },
    { latestLedgerCloseTime: "18446744073709551616" },
  ])("retains uncertainty when the final lookup lacks coverage: %j", async (metadata) => {
    server.getTransaction
      .mockResolvedValueOnce(notFound)
      .mockResolvedValueOnce({ ...notFound, ...metadata });
    await expect(allowanceHasExpired(tx)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
  });
  it("retains uncertainty for legacy intents without a preparation ledger", async () => {
    await expect(
      allowanceHasExpired({ txHash: tx.txHash, maxTime: tx.maxTime }),
    ).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
  });
  it("accepts coverage starting at the preparation ledger", async () => {
    server.getTransaction.mockResolvedValue({ ...notFound, oldestLedger: 90 });
    expect(await allowanceHasExpired(tx)).toBe(true);
  });
  it.each(["SUCCESS", "FAILED"])("does not call a %s transaction expired", async (status) => {
    server.getTransaction.mockResolvedValue({ status });
    expect(await allowanceHasExpired(tx)).toBe(false);
    expect(server.getLatestLedger).not.toHaveBeenCalled();
  });
  it.each(["999", "1000"])("retains protection at close time %s", async (time) => {
    server.getLedgers.mockResolvedValue({ ledgers: [{ sequence: 100, ledgerCloseTime: time }] });
    expect(await allowanceHasExpired(tx)).toBe(false);
  });
  it("handles confirmation arriving during the ledger read", async () => {
    server.getTransaction
      .mockResolvedValueOnce(notFound)
      .mockResolvedValueOnce({ status: "SUCCESS" });
    expect(await allowanceHasExpired(tx)).toBe(false);
  });
  it.each(
    [
      [],
      [{ sequence: 99, ledgerCloseTime: "1001" }],
      [{ sequence: 100, ledgerCloseTime: 1001 }],
      [{ sequence: 100, ledgerCloseTime: "bad" }],
      [{ sequence: 100, ledgerCloseTime: "18446744073709551616" }],
    ].map((ledgers) => ({ ledgers })),
  )("retains protection on malformed ledgers %j", async ({ ledgers }) => {
    server.getLedgers.mockResolvedValue({ ledgers });
    await expect(allowanceHasExpired(tx)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
  });
  it.each([0, -1, 1.1, NaN, 0x1_0000_0000])(
    "retains protection on invalid latest ledger %s",
    async (sequence) => {
      server.getLatestLedger.mockResolvedValue({ sequence });
      await expect(allowanceHasExpired(tx)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    },
  );
  it.each(["getTransaction", "getLatestLedger", "getLedgers"] as const)(
    "retains protection if %s is unavailable",
    async (method) => {
      server[method].mockRejectedValue(new Error("SDK/RPC unavailable"));
      await expect(allowanceHasExpired(tx)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    },
  );
});
