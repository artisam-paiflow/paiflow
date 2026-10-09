import "server-only";
import type { TransactionOutcome } from "@prisma/client";
import { log } from "@/lib/log";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { invalidateDashboardBalances } from "@/lib/stellar/dashboard-balance-cache";
import { enqueueAnalytics } from "./outbox";
import { TRACKING_VERSION } from "./policy";
export const TERMINAL_OUTCOMES: readonly TransactionOutcome[] = ["CONFIRMED", "FAILED"];
export function canTransition(
  from: TransactionOutcome,
  to: TransactionOutcome,
  submissionAttempt = false,
  previouslyAccepted = false,
): boolean {
  if (from === to || TERMINAL_OUTCOMES.includes(from)) return false;
  if (to === "RECEIVED") return false;
  // Missing finality/read errors do not undo an explicit submission refusal.
  if (from === "REJECTED" && to === "UNRESOLVED" && !submissionAttempt) return false;
  if ((from === "ACCEPTED" || previouslyAccepted) && to === "REJECTED") return false;
  if (from === "UNRESOLVED" && (to === "REJECTED" || to === "ACCEPTED") && !submissionAttempt)
    return false;
  return true;
}
export type TransactionObservation = { submissionRevision: number; outcomeRevision: number };
/** Capture before an RPC read so a delayed missing result cannot undo newer evidence. */
export async function transactionObservation(
  txHash: string,
): Promise<TransactionObservation | undefined> {
  const row = await db.signedTransaction.findUnique({ where: { txHash: txHash.toLowerCase() } });
  if (!row || row.trackingVersion !== TRACKING_VERSION || row.network !== env().STELLAR_NETWORK)
    return undefined;
  return { submissionRevision: row.submissionRevision, outcomeRevision: row.outcomeRevision };
}
/** Reserve before sending. Failure must stop the send; legacy/untracked callers remain untracked. */
export async function beginTransactionSubmission(txHash: string): Promise<number | undefined> {
  const row = await db.signedTransaction.findUnique({ where: { txHash: txHash.toLowerCase() } });
  if (!row || row.trackingVersion !== TRACKING_VERSION || row.network !== env().STELLAR_NETWORK)
    return undefined;
  const updated = await db.signedTransaction.update({
    where: { id: row.id },
    data: { submissionRevision: { increment: 1 } },
    select: { submissionRevision: true },
  });
  return updated.submissionRevision;
}
export const TRANSACTION_EVENT_KIND = {
  DEPLOY: "deploy",
  TRIGGER: "trigger",
  INVOKE: "invoke",
  API_EXECUTE: "api_execute",
} as const;
/** Compare-and-set plus transactional outbox prevents regressions and duplicate outcomes. */
export async function recordTransactionOutcome(
  txHash: string,
  outcome: TransactionOutcome,
  details: {
    ledger?: number;
    failureCode?: "RPC_REJECTED" | "ONCHAIN_FAILED" | "RPC_UNAVAILABLE" | "FINALITY_UNKNOWN";
    deploymentId?: string;
    executionOnly?: boolean;
    /** Only a sendTransaction attempt, never a status read, can supply this. */
    submissionAttempt?: number;
    /** Evidence captured before a status read, never evidence of a resend. */
    observation?: TransactionObservation;
  } = {},
) {
  try {
    let confirmedDeploymentId: string | null = null;
    const changed = await db.$transaction(async (tx) => {
      for (let retries = 0; retries < 5; retries++) {
        const row = await tx.signedTransaction.findUnique({
          where: { txHash: txHash.toLowerCase() },
        });
        if (
          !row ||
          row.trackingVersion !== TRACKING_VERSION ||
          !row.outcome ||
          row.network !== env().STELLAR_NETWORK ||
          (details.executionOnly && row.kind === "DEPLOY") ||
          (details.deploymentId && row.deploymentId !== details.deploymentId) ||
          (!TERMINAL_OUTCOMES.includes(outcome) &&
            ((details.submissionAttempt !== undefined &&
              details.submissionAttempt !== row.submissionRevision &&
              !(
                outcome === "ACCEPTED" &&
                details.submissionAttempt > 0 &&
                details.submissionAttempt < row.submissionRevision
              )) ||
              (details.observation &&
                (details.observation.submissionRevision !== row.submissionRevision ||
                  details.observation.outcomeRevision !== row.outcomeRevision))))
        )
          return false;
        // Queued acceptance is positive same-hash evidence, even when an older send
        // answers late. Enrich terminal rows without reopening their lifecycle.
        if (outcome === "ACCEPTED" && !row.acceptedAt && TERMINAL_OUTCOMES.includes(row.outcome)) {
          const enriched = await tx.signedTransaction.updateMany({
            where: {
              id: row.id,
              outcomeRevision: row.outcomeRevision,
              submissionRevision: row.submissionRevision,
              acceptedAt: null,
            },
            data: { acceptedAt: new Date() },
          });
          if (!enriched.count) continue;
          return false;
        }
        if (
          !canTransition(
            row.outcome,
            outcome,
            details.submissionAttempt !== undefined,
            Boolean(row.acceptedAt),
          )
        )
          return false;
        const now = new Date();
        const outcomeRevision = row.outcomeRevision + 1;
        const { count } = await tx.signedTransaction.updateMany({
          where: {
            id: row.id,
            outcome: row.outcome,
            outcomeRevision: row.outcomeRevision,
            submissionRevision: row.submissionRevision,
          },
          data: {
            outcome,
            outcomeRevision,
            ledger: details.ledger,
            failureCode: outcome === "CONFIRMED" ? null : (details.failureCode ?? null),
            ...(outcome === "ACCEPTED" && !row.acceptedAt ? { acceptedAt: now } : {}),
            ...(outcome === "CONFIRMED" ? { confirmedAt: now } : {}),
            ...(outcome === "FAILED" ? { failedAt: now } : {}),
            ...(outcome === "REJECTED" ? { rejectedAt: now } : {}),
            nextCheckAt: TERMINAL_OUTCOMES.includes(outcome) ? null : new Date(Date.now() + 30_000),
          },
        });
        if (!count) continue;
        await enqueueAnalytics(tx, {
          key: `${row.network}:outcome:${row.txHash}:${outcomeRevision}`,
          distinctId:
            row.userId ??
            (row.apiTokenId ? `api:${row.apiTokenId}` : `wallet:${row.signerAddress}`),
          name: "transaction_outcome",
          properties: {
            deployment_id: row.deploymentId,
            tx_hash: row.txHash,
            signer_address: row.signerAddress,
            kind: TRANSACTION_EVENT_KIND[row.kind],
            outcome,
            outcome_revision: outcomeRevision,
            ledger: details.ledger ?? null,
            flow_id: row.deploymentId
              ? ((
                  await tx.deployment.findUnique({
                    where: { id: row.deploymentId },
                    select: { flowId: true },
                  })
                )?.flowId ?? null)
              : null,
            failure_code: details.failureCode ?? null,
          },
          context: {
            audience: row.audience,
            account_id: row.callerAccountId ?? "",
            caller_type: row.userId ? "session" : row.apiTokenId ? "api" : "wallet",
            stellar_network: row.network,
            app_env: env().NEXT_PUBLIC_APP_ENV,
            app_version: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
            app_host: new URL(env().NEXT_PUBLIC_APP_URL).host,
            tracking_version: TRACKING_VERSION,
          },
          personProfile: Boolean(row.userId),
        });
        if (outcome === "CONFIRMED") confirmedDeploymentId = row.deploymentId;
        return true;
      }
      return false;
    });
    if (changed && confirmedDeploymentId)
      invalidateDashboardBalances(confirmedDeploymentId, txHash);
    return changed;
  } catch {
    log.warn(
      { txHash, outcome },
      "transaction outcome: bookkeeping unavailable; reconciliation will retry",
    );
    return false;
  }
}
