import "server-only";
import { TRACKING_VERSION } from "@/lib/analytics/policy";
import { recordTransactionOutcome } from "@/lib/analytics/outcomes";
import { CRON_LIMITS } from "@/lib/cron/config";
import { db } from "@/lib/db";
import {
  projectControlFinality,
  storedControlFinality,
  retainedControlFinality,
} from "@/lib/deployments/control-finality";
import { runDeploymentWork } from "@/lib/deployments/service-work";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { invalidateDashboardBalances } from "./dashboard-balance-cache";

/** DB-only convergence survives crashes after signed finality was recorded, RPC
 * history expiry, closed browsers and hosted opt-out. It never submits or expires.
 * Select proof and unfinished projections BEFORE LIMIT; unknown old hashes must
 * not starve repairable payments. txHash indexes support both evidence joins. */
export async function reconcileControlIntents({
  batch = CRON_LIMITS.reconcileControlIntents.batch,
  budgetMs = CRON_LIMITS.reconcileControlIntents.budgetMs,
}: { batch?: number; budgetMs?: number } = {}) {
  const started = Date.now();
  let visited = 0,
    checked = 0,
    repaired = 0,
    failed = 0;
  const rows = await db.$queryRaw<
    Array<{
      id: string;
      deploymentId: string;
      finalityNextCheckAt: Date;
      trackingVersion: string | null;
    }>
  >`
    SELECT i."id", i."deploymentId", i."finalityNextCheckAt", s."trackingVersion"
    FROM "WalletControlIntent" i
    JOIN "Deployment" d ON d."id" = i."deploymentId"
    JOIN "SignedTransaction" s ON s."txHash" = i."txHash"
    WHERE i."network" = ${env().STELLAR_NETWORK}
      AND d."network" = i."network" AND d."serviceState" = 'ACTIVE'
      AND i."finalityNextCheckAt" <= ${new Date()}
      AND s."network" = i."network" AND s."deploymentId" = i."deploymentId"
      AND s."signerAddress" = i."walletAddress" AND s."signedBySource" AND NOT s."isFeeBump"
      AND i."txHash" ~ '^[a-f0-9]{64}$'
      AND ((i."action" = 'payment.execute' AND s."kind" IN ('API_EXECUTE', 'TRIGGER'))
        OR (i."action" IN ('configuration.mutate', 'subscription.cancel', 'subscription.reactivate',
          'schedule.pause', 'schedule.resume', 'schedule.retrieve', 'schedule.fund', 'webhook.fund')
          AND s."kind" = 'INVOKE'))
      AND (
        (s."ledger" > 0
          AND (s."outcome" = 'CONFIRMED' OR (s."outcome" = 'FAILED' AND s."failureCode" = 'ONCHAIN_FAILED'))
          AND (i."state" IN ('PREPARED', 'SUBMITTING')
            OR (i."state"::text = CASE WHEN s."outcome" = 'CONFIRMED' THEN 'SUCCESS' ELSE 'FAILED' END
              AND (i."ledger" IS NULL OR EXISTS (
                SELECT 1 FROM "ServiceTransaction" st JOIN "DeploymentWork" w ON w."id" = st."workId"
                WHERE st."txHash" = i."txHash" AND st."state" = 'PENDING' AND w."deploymentId" = i."deploymentId"
              )))))
        OR (i."state" IN ('SUCCESS', 'FAILED') AND i."ledger" > 0
          AND s."outcome" IN ('RECEIVED', 'ACCEPTED', 'UNRESOLVED', 'REJECTED')
          AND s."failureCode" IS DISTINCT FROM 'CONTROL_EXPIRED'
          AND s."trackingVersion" = ${TRACKING_VERSION})
        OR (s."failureCode" IS DISTINCT FROM 'CONTROL_EXPIRED'
          AND (i."state" IN ('PREPARED', 'SUBMITTING')
            OR (i."state" IN ('SUCCESS', 'FAILED') AND i."ledger" > 0
              AND s."outcome" IN ('RECEIVED', 'ACCEPTED', 'UNRESOLVED', 'REJECTED')
              AND s."trackingVersion" = ${TRACKING_VERSION}))
          AND EXISTS (
            SELECT 1 FROM "ServiceTransaction" st JOIN "DeploymentWork" w ON w."id" = st."workId"
            WHERE st."txHash" = i."txHash" AND st."transport" = 'rpc'
              AND st."state" IN ('SUCCESS', 'FAILED') AND st."ledger" > 0
              AND w."deploymentId" = i."deploymentId"
          ))
      )
    ORDER BY i."finalityNextCheckAt", i."id"
    LIMIT ${Math.max(0, Math.min(100, Math.floor(batch)))}
  `;
  for (const row of rows) {
    if (Date.now() - started >= budgetMs) break;
    visited++;
    await runDeploymentWork(
      row.deploymentId,
      "wallet-control-finality-reconciliation",
      async () => {
        const claim = await db.walletControlIntent.updateMany({
          where: { id: row.id, finalityNextCheckAt: row.finalityNextCheckAt },
          // Reserve a retry before projection; a crash or poison row rotates behind
          // other eligible work without changing financial finality.
          data: { finalityNextCheckAt: new Date(Date.now() + 60_000) },
        });
        if (!claim.count) return;
        checked++;
        try {
          const intent = await db.walletControlIntent.findUniqueOrThrow({ where: { id: row.id } });
          const proof = (await storedControlFinality(intent)) ?? retainedControlFinality(intent);
          if (!proof) {
            failed++;
            return;
          }
          const projected = await projectControlFinality(intent.deploymentId, intent.txHash, proof);
          if (projected) {
            // A crash after business projection but before signed/outbox projection
            // must converge in the opposite direction too. No RPC is needed.
            await recordTransactionOutcome(
              intent.txHash,
              proof.state === "SUCCESS" ? "CONFIRMED" : "FAILED",
              {
                deploymentId: intent.deploymentId,
                executionOnly: true,
                controlIntentId: intent.id,
                ledger: proof.ledger,
                ...(proof.state === "FAILED" ? { failureCode: "ONCHAIN_FAILED" as const } : {}),
              },
            );
            // Service proof must not hide a failed signed/outbox write. Current
            // tracking policy stays retryable; obsolete analytics is not rewritten.
            const signed = await storedControlFinality(projected, db, { includeService: false });
            if (
              row.trackingVersion === TRACKING_VERSION &&
              (!signed || signed.state !== proof.state || signed.ledger !== proof.ledger)
            ) {
              failed++;
              return;
            }
            repaired++;
            if (proof.state === "SUCCESS")
              invalidateDashboardBalances(intent.deploymentId, intent.txHash);
          }
        } catch {
          failed++;
          log.warn(
            { intentId: row.id },
            "wallet-control finality projection unavailable; retry retained",
          );
        }
      },
    );
  }
  return { checked, repaired, failed, truncated: visited < rows.length };
}
