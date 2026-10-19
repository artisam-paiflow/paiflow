import "server-only";
import { Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { env, stellarPassphrase } from "@/lib/env";
import type { PreparedRecovery } from "@/lib/deployments/prepared-recovery-schema";
import { sorobanRpc } from "./client";

type PreparedDeployment = {
  id: string;
  status: string;
  serviceState: string;
  network: string;
  unsignedXdr: string | null;
  sourceAccount: string | null;
  deployTxHash: string | null;
};
const blocked: PreparedRecovery = { status: "BLOCKED" };

/** Only a never-accepted preparation can be signed again or deliberately replaced. */
export async function preparedDeploymentRecovery(d: PreparedDeployment): Promise<PreparedRecovery> {
  try {
    if (
      d.status !== "PENDING_SIGNATURE" ||
      d.serviceState !== "ACTIVE" ||
      d.deployTxHash ||
      d.network !== env().STELLAR_NETWORK ||
      !d.unsignedXdr ||
      !d.sourceAccount
    )
      return blocked;
    const tx = TransactionBuilder.fromXDR(d.unsignedXdr, stellarPassphrase());
    if (
      !(tx instanceof Transaction) ||
      tx.source !== d.sourceAccount ||
      !tx.timeBounds ||
      !/^\d+$/.test(tx.timeBounds.maxTime) ||
      BigInt(tx.timeBounds.maxTime) <= 0n
    )
      return blocked;
    const txHash = tx.hash().toString("hex");
    const safeToResume = async () => {
      const signed = await db.signedTransaction.findUnique({ where: { txHash } });
      return (
        !signed ||
        (signed.deploymentId === d.id &&
          signed.network === d.network &&
          !signed.acceptedAt &&
          ((signed.outcome === "RECEIVED" && signed.submissionRevision === 0) ||
            signed.outcome === "REJECTED"))
      );
    };
    if (!(await safeToResume())) return blocked;
    if (BigInt(tx.timeBounds.maxTime) > BigInt(Math.floor(Date.now() / 1000))) {
      return {
        status: "RESUMABLE",
        unsignedXdr: d.unsignedXdr,
        txHash,
        sourceAccount: d.sourceAccount,
        network: env().STELLAR_NETWORK,
      };
    }
    // Local time only selects this path. A closed ledger proves the envelope can
    // no longer land, and durable state must still prove no ambiguous submission.
    const server = sorobanRpc();
    if ((await server.getTransaction(txHash)).status !== "NOT_FOUND") return blocked;
    const latest = await server.getLatestLedger();
    const ledgers = await server.getLedgers({
      startLedger: latest.sequence,
      pagination: { limit: 1 },
    });
    const ledger = ledgers.ledgers[0];
    if (
      ledger?.sequence !== latest.sequence ||
      !/^\d+$/.test(ledger.ledgerCloseTime) ||
      BigInt(ledger.ledgerCloseTime) <= BigInt(tx.timeBounds.maxTime)
    )
      return blocked;
    if ((await server.getTransaction(txHash)).status !== "NOT_FOUND") return blocked;
    const current = await db.deployment.findUnique({ where: { id: d.id } });
    if (
      !current ||
      current.status !== "PENDING_SIGNATURE" ||
      current.serviceState !== "ACTIVE" ||
      current.deployTxHash ||
      current.unsignedXdr !== d.unsignedXdr ||
      current.network !== d.network ||
      current.sourceAccount !== d.sourceAccount ||
      !(await safeToResume())
    )
      return blocked;
    return { status: "EXPIRED" };
  } catch {
    return blocked;
  }
}
