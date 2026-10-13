import "server-only";
import { AppError } from "@/lib/errors";
import { sorobanRpc } from "./client";

type ExpiryProof = { txHash: string; maxTime: string; preparationLedger?: number };
export function allowanceHasExpired(tx: ExpiryProof): Promise<boolean> {
  return transactionHasExpired(
    tx,
    "Cannot establish approval finality; check its status again before approving",
  );
}

/** NOT_FOUND plus wall-clock time cannot prove an uncertain transaction expired. */
export async function transactionHasExpired(
  tx: ExpiryProof,
  errorMessage = "Cannot establish payment finality; check its status again before paying",
): Promise<boolean> {
  try {
    const server = sorobanRpc();
    const got = await server.getTransaction(tx.txHash);
    if (got.status === "SUCCESS" || got.status === "FAILED") return false;
    if (got.status !== "NOT_FOUND") throw new Error();
    const latest = await server.getLatestLedger();
    if (!Number.isInteger(latest.sequence) || latest.sequence <= 0 || latest.sequence > 0xffff_ffff)
      throw new Error();
    const ledgers = await server.getLedgers({
      startLedger: latest.sequence,
      pagination: { limit: 1 },
    });
    const ledger = ledgers.ledgers[0];
    const closeTime = ledger?.ledgerCloseTime;
    if (
      ledger?.sequence !== latest.sequence ||
      typeof closeTime !== "string" ||
      !/^[0-9]+$/.test(closeTime) ||
      BigInt(closeTime) > 0xffff_ffff_ffff_ffffn
    )
      throw new Error();
    if (BigInt(closeTime) <= BigInt(tx.maxTime)) return false;
    // A transaction may have landed while fetching the closing ledger.
    const final = await server.getTransaction(tx.txHash);
    if (final.status === "SUCCESS" || final.status === "FAILED") return false;
    if (final.status !== "NOT_FOUND") throw new Error();
    // The independently read ledger does not establish the lookup backend's
    // freshness or history coverage (RPC requests may hit different replicas).
    // Legacy intents without a preparation bound must retain unknown finality.
    const validSequence = (value: number | undefined): value is number =>
      typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 0xffff_ffff;
    const validTime = (value: unknown): value is string =>
      typeof value === "string" &&
      /^[0-9]+$/.test(value) &&
      BigInt(value) <= 0xffff_ffff_ffff_ffffn;
    if (
      !validSequence(tx.preparationLedger) ||
      !validSequence(final.latestLedger) ||
      !validSequence(final.oldestLedger) ||
      !validTime(final.latestLedgerCloseTime) ||
      !validTime(final.oldestLedgerCloseTime) ||
      final.oldestLedger > tx.preparationLedger ||
      final.latestLedger < latest.sequence ||
      final.latestLedger < final.oldestLedger ||
      BigInt(final.latestLedgerCloseTime) < BigInt(closeTime) ||
      BigInt(final.latestLedgerCloseTime) <= BigInt(tx.maxTime) ||
      BigInt(final.oldestLedgerCloseTime) > BigInt(final.latestLedgerCloseTime) ||
      BigInt(final.oldestLedgerCloseTime) > BigInt(tx.maxTime)
    )
      throw new Error();
    return true;
  } catch {
    throw new AppError("UPSTREAM_RPC", errorMessage);
  }
}
