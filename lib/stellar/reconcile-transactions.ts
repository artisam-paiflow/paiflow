import "server-only";
import { CRON_LIMITS } from "@/lib/cron/config";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { TRACKING_VERSION } from "@/lib/analytics/policy";
import { recordTransactionOutcome } from "@/lib/analytics/outcomes";
import { confirmDeployment } from "@/lib/deployments/confirm";
import { extractCreatedContract } from "./deploy";
import { sorobanRpc } from "./client";

// A recently submitted deployment must not disappear behind exponential
// NOT_FOUND backoff while the browser is gone. The minute scheduler can then
// observe finality promptly; older unknown hashes retain bounded backoff and
// remain unresolved when RPC history expires.
const RECENT_DEPLOYMENT_MS = 15 * 60_000;
const RECENT_DEPLOYMENT_RECHECK_MS = 60_000;

/** Reads only future-policy attempts, bounded by rows, per-RPC timeout and total budget. */
export async function reconcileTransactions({
  batch = CRON_LIMITS.reconcileTransactions.batch,
  budgetMs = CRON_LIMITS.reconcileTransactions.budgetMs,
}: { batch?: number; budgetMs?: number } = {}) {
  const started = Date.now();
  let checked = 0;
  let confirmed = 0;
  let failed = 0;
  let unresolved = 0;
  const rows = await db.signedTransaction.findMany({
    where: {
      OR: [{ deploymentId: null }, { deployment: { serviceState: "ACTIVE" } }],
      trackingVersion: TRACKING_VERSION,
      network: env().STELLAR_NETWORK,
      outcome: { in: ["RECEIVED", "ACCEPTED", "UNRESOLVED", "REJECTED"] },
      nextCheckAt: { lte: new Date() },
    },
    orderBy: { nextCheckAt: "asc" },
    take: batch,
    include: { deployment: { include: { flow: { select: { templateKind: true } } } } },
  });
  for (const row of rows) {
    if (Date.now() - started >= budgetMs) break;
    const now = new Date();
    const claimed = await db.signedTransaction.updateMany({
      where: {
        id: row.id,
        outcome: row.outcome,
        nextCheckAt: row.nextCheckAt,
        submissionRevision: row.submissionRevision,
        outcomeRevision: row.outcomeRevision,
      },
      data: {
        lastCheckedAt: now,
        checkAttempts: { increment: 1 },
        nextCheckAt: new Date(Date.now() + 60_000),
      },
    });
    if (!claimed.count) continue;
    checked++;
    const observation = {
      submissionRevision: row.submissionRevision,
      outcomeRevision: row.outcomeRevision,
    };
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const got = await Promise.race([
        sorobanRpc().getTransaction(row.txHash),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("RPC deadline")), 3_000);
        }),
      ]).finally(() => clearTimeout(timer));
      if (got.status === "SUCCESS") {
        if (row.kind === "DEPLOY" && row.deployment) {
          // Same finalization path as the browser: schedule, employees, KYC,
          // webhook credential and deterministic pipeline addresses are preserved.
          if (
            ["SUBMITTED", "FAILED"].includes(row.deployment.status) &&
            row.deployment.deployTxHash === row.txHash
          )
            await confirmDeployment(
              row.deployment,
              { txHash: row.txHash, contractAddress: extractCreatedContract(got) ?? undefined },
              row.signerAddress,
              true,
            );
          else if (row.deployment.status !== "CONFIRMED") continue;
        }
        if (await recordTransactionOutcome(row.txHash, "CONFIRMED", { ledger: got.ledger }))
          confirmed++;
      } else if (got.status === "FAILED") {
        if (row.kind === "DEPLOY" && row.deploymentId)
          await db.deployment.updateMany({
            where: { id: row.deploymentId, status: "SUBMITTED", deployTxHash: row.txHash },
            data: { status: "FAILED", errorMessage: "Transaction failed on the network" },
          });
        if (
          await recordTransactionOutcome(row.txHash, "FAILED", {
            ledger: got.ledger,
            failureCode: "ONCHAIN_FAILED",
          })
        )
          failed++;
      } else {
        let changed = false;
        if (row.outcome !== "REJECTED") {
          changed = await recordTransactionOutcome(row.txHash, "UNRESOLVED", {
            failureCode: "FINALITY_UNKNOWN",
            observation,
          });
          unresolved++;
        }
        // Avoid querying a permanently missing hash past the recent RPC window.
        // Stop after six days, preserving UNRESOLVED or the known rejection.
        await db.signedTransaction.updateMany({
          where: {
            id: row.id,
            outcome: row.outcome === "REJECTED" ? "REJECTED" : "UNRESOLVED",
            submissionRevision: row.submissionRevision,
            outcomeRevision: row.outcomeRevision + (changed ? 1 : 0),
          },
          data: {
            nextCheckAt:
              Date.now() - row.createdAt.getTime() >= 6 * 24 * 3600_000
                ? null
                : new Date(
                    Date.now() +
                      (row.kind === "DEPLOY" &&
                      Date.now() - row.createdAt.getTime() < RECENT_DEPLOYMENT_MS
                        ? RECENT_DEPLOYMENT_RECHECK_MS
                        : Math.min(3600_000, 30_000 * 2 ** Math.min(row.checkAttempts, 7))),
                  ),
          },
        });
      }
    } catch {
      log.warn(
        { txHash: row.txHash },
        "transaction reconciliation: read or bookkeeping unavailable",
      );
      if (row.outcome !== "REJECTED") {
        await recordTransactionOutcome(row.txHash, "UNRESOLVED", {
          failureCode: "RPC_UNAVAILABLE",
          observation,
        });
        unresolved++;
      }
    }
  }
  return { checked, confirmed, failed, unresolved, truncated: checked < rows.length };
}
