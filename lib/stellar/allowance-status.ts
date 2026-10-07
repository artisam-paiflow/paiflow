import "server-only";
import { AppError } from "@/lib/errors";
import { sorobanRpc } from "./client";

/** NOT_FOUND plus wall-clock time cannot prove an uncertain approval expired. */
export async function allowanceHasExpired(tx: {
  txHash: string;
  maxTime: string;
}): Promise<boolean> {
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
    return true;
  } catch {
    throw new AppError(
      "UPSTREAM_RPC",
      "Cannot establish approval finality; check its status again before approving",
    );
  }
}
