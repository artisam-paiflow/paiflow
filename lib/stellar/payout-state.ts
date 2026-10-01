import "server-only";
import { BASE_FEE, Operation, TransactionBuilder, rpc, scValToNative } from "@stellar/stellar-sdk";
import { AppError } from "@/lib/errors";
import { stellarPassphrase } from "@/lib/env";
import { sorobanRpc } from "./client";

export async function readPayoutState(
  contract: string,
  method: string,
  from: string,
): Promise<unknown> {
  const server = sorobanRpc();
  const account = await server.getAccount(from);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(Operation.invokeContractFunction({ contract, function: method, args: [] }))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim) || !sim.result?.retval)
    throw new AppError("UPSTREAM_RPC", `Could not read ${method} for payout eligibility`);
  return scValToNative(sim.result.retval);
}

export type PayoutTransaction = { txHash: string; maxTime: string };

/** Wall-clock expiry cannot prove a Stellar transaction will never land. */
export async function payoutTransactionFinished(tx: PayoutTransaction): Promise<boolean> {
  const server = sorobanRpc();
  const got = await payoutTransactionStatus(tx.txHash);
  if (got.status === "SUCCESS" || got.status === "FAILED") return true;
  const latest = await payoutRpc(() => server.getLatestLedger());
  const ledgers = await payoutRpc(() =>
    server.getLedgers({ startLedger: latest.sequence, pagination: { limit: 1 } }),
  );
  const closeTime = ledgers.ledgers[0]?.ledgerCloseTime;
  if (!closeTime || !/^\d+$/.test(closeTime))
    throw new AppError("UPSTREAM_RPC", "Cannot establish ledger-time expiry");
  return BigInt(closeTime) > BigInt(tx.maxTime);
}

export function payoutTransactionStatus(txHash: string) {
  return payoutRpc(() => sorobanRpc().getTransaction(txHash));
}

async function payoutRpc<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    throw new AppError(
      "UPSTREAM_RPC",
      "The Soroban RPC request failed; payout protection is retained",
    );
  }
}
