import "server-only";
import { apiTokenKey, signedTokenAttribution, type ApiTokenType } from "@/lib/api/v1/auth";
import type { Transaction } from "@stellar/stellar-sdk";
import { rpc } from "@stellar/stellar-sdk";
import {
  beginTransactionSubmission,
  recordTransactionOutcome,
  transactionObservation,
  type TransactionObservation,
} from "@/lib/analytics/outcomes";
import { audit, wasTxConfirmedFor } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { invalidateDashboardBalances } from "@/lib/stellar/dashboard-balance-cache";
import { log } from "@/lib/log";
import { acquireWaitSlot } from "@/lib/api/v1/wait-slots";
import { explainFailedTx, ingestEventsBounded, waitForFinal } from "@/lib/api/v1/execute";
import type { ExecuteSubmitted } from "@/lib/api/v1/schema";
import type { PipelineSnapshotNode } from "@/lib/pipeline-snapshot";
import { recordSignedTransaction } from "@/lib/signed-tx";
import { sorobanRpc } from "./client";
import { signerFromTransaction } from "./signer";

const rpcFailed = () => new AppError("UPSTREAM_RPC", "The Soroban RPC request failed; try again");

async function viaRpc<T>(
  fn: () => Promise<T>,
  txHash?: string,
  evidence: { submissionAttempt?: number; observation?: TransactionObservation } = {},
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (txHash)
      await recordTransactionOutcome(txHash, "UNRESOLVED", {
        failureCode: "RPC_UNAVAILABLE",
        ...evidence,
      });
    log.warn({ err }, "v1 execute submit: RPC call failed");
    throw rpcFailed();
  }
}

export async function submitPreparedDeposit({
  tx,
  wait,
  tokenId,
  tokenType,
  deploymentId,
  deployment,
  nodes,
  ip,
  auditKind = "execute",
  allowSubmit = true,
}: {
  tx: Transaction;
  wait: boolean;
  tokenId: string;
  tokenType?: ApiTokenType;
  deploymentId: string;
  deployment: { network: string; ownerId: string };
  nodes: PipelineSnapshotNode[];
  ip: string;
  auditKind?: "execute" | "payout";
  allowSubmit?: boolean;
}): Promise<ExecuteSubmitted> {
  const txHash = tx.hash().toString("hex");
  const signer = signerFromTransaction(tx);

  const record = {
    deploymentId: deploymentId,
    tokenId: tokenId,
    tokenType: tokenType ?? "deployment_token",
    txHash,
    signerAddress: signer.ok ? signer.signerAddress : null,
  };
  // The partner signs with its own key and has no session; the token's
  // owner is not the signer, so no user is attached. Upsert on the hash, so
  // the resubmit-to-poll pattern this route documents adds no second row.
  await recordSignedTransaction({
    signer,
    kind: "API_EXECUTE",
    network: deployment.network,
    userId: null,
    ...signedTokenAttribution({ tokenId, tokenType }),
    deploymentId: deploymentId,
    ip,
  });

  const server = sorobanRpc();
  const preflightObservation = await transactionObservation(txHash);
  let got = await viaRpc(() => server.getTransaction(txHash), txHash, {
    observation: preflightObservation,
  });

  if (got.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    if (!allowSubmit)
      throw new AppError(
        "VALIDATION",
        "This payout no longer owns recipient protection; only final-status retries are allowed",
      );
    const submissionAttempt = await beginTransactionSubmission(txHash);
    const send = await viaRpc(() => server.sendTransaction(tx), txHash, { submissionAttempt });

    if (send.status === "ERROR") {
      await recordTransactionOutcome(txHash, "REJECTED", {
        failureCode: "RPC_REJECTED",
        submissionAttempt,
      });
      const error = await explainFailedTx(
        { resultXdr: send.errorResult, diagnosticEventsXdr: send.diagnosticEvents },
        nodes,
      );
      return { txHash, status: "FAILED", error };
    }
    if (send.status === "TRY_AGAIN_LATER") {
      await recordTransactionOutcome(txHash, "REJECTED", {
        failureCode: "RPC_REJECTED",
        submissionAttempt,
      });
      throw new AppError(
        "UPSTREAM_RPC",
        "The network is busy and did not accept the transaction; submit the same envelope again",
      );
    }
    await recordTransactionOutcome(txHash, "ACCEPTED", { submissionAttempt });
    // DUPLICATE: an earlier submit already sent it and wrote the row.
    if (send.status === "PENDING") {
      await audit({
        action: auditKind === "payout" ? "API_PAYOUT_SUBMITTED" : "API_EXECUTE_SUBMITTED",
        userId: deployment.ownerId,
        ip,
        metadata: record,
      });
    }

    if (!wait) return { txHash, status: "PENDING" };
    // The transaction is already sent, so a caller over its concurrent-wait cap gets the
    // `wait=false` answer rather than an error it might answer by preparing a new deposit.
    const slot = await acquireWaitSlot(apiTokenKey(tokenId, tokenType));
    if (!slot) {
      log.info(
        { deploymentId: deploymentId, tokenId: tokenId, txHash },
        "v1 execute submit: wait slots full, answering PENDING without waiting",
      );
      return { txHash, status: "PENDING" };
    }
    try {
      const observation = await transactionObservation(txHash);
      got = await viaRpc(() => waitForFinal(txHash), txHash, { observation });
    } finally {
      await slot.release();
    }
  }

  if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) {
    await recordTransactionOutcome(txHash, "CONFIRMED", { ledger: got.ledger, deploymentId });
    invalidateDashboardBalances(deploymentId, txHash);
    // A lookup failure writes a possible duplicate row rather than none.
    const alreadyConfirmed = await wasTxConfirmedFor(deploymentId, txHash).catch(() => false);
    if (!alreadyConfirmed) {
      await ingestEventsBounded(deploymentId, txHash);
      await audit({
        action: auditKind === "payout" ? "API_PAYOUT_CONFIRMED" : "API_EXECUTE_CONFIRMED",
        userId: deployment.ownerId,
        ip,
        metadata: { ...record, ledger: got.ledger },
      });
    }
    return { txHash, status: "SUCCESS", ledger: got.ledger };
  }

  if (got.status === rpc.Api.GetTransactionStatus.FAILED) {
    await recordTransactionOutcome(txHash, "FAILED", {
      ledger: got.ledger,
      failureCode: "ONCHAIN_FAILED",
      deploymentId,
    });
    const error = await explainFailedTx(got, nodes);
    return { txHash, status: "FAILED", ledger: got.ledger, error };
  }

  return { txHash, status: "PENDING" };
}
