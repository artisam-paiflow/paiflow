import { NextRequest, NextResponse } from "next/server";
import { SettlementVerificationSchema } from "@/lib/deployments/service-schema";
import { lockDeployment } from "@/lib/deployments/service-work";
import {
  deploymentSubmissionHash,
  recoveredDeploymentReferences,
} from "@/lib/deployments/deployment-recovery";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { enforceWriteRateLimit } from "@/lib/api/write-rate-limit";
import { AppError, withErrorHandler } from "@/lib/errors";

/** Manual verification is an operator attestation backed by an external recovery
 * record. It resolves a specific obligation; it cannot force retirement. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession({ role: "ADMIN" });
    await enforceWriteRateLimit("adminWrite", user.id);
    const { id } = await ctx.params;
    const body = SettlementVerificationSchema.parse(await req.json());
    await db.$transaction(async (tx) => {
      const deployment = await lockDeployment(tx, id);
      if (deployment.serviceState !== "RETIRING")
        throw new AppError("CONFLICT", "Deployment is not retiring");
      if (body.kind === "fence-work") {
        // This attests only that the worker cannot continue. Pending payments
        // and finality remain unresolved until independently verified.
        const fenced = await tx.deploymentWork.updateMany({
          where: { id: body.id, deploymentId: id, state: "OPEN" },
          data: {
            state: "BLOCKED",
            blocker: "Worker stopped; transaction finality and obligations require reconciliation",
            reconciliationEvidence: body.evidence,
          },
        });
        if (!fenced.count) throw new AppError("NOT_FOUND", "Open work not found");
      } else if (body.kind === "transaction") {
        if (await tx.deploymentWork.count({ where: { deploymentId: id, state: "OPEN" } }))
          throw new AppError(
            "CONFLICT",
            "Fence and reconcile active workers before verifying finality",
          );
        const pending = await tx.serviceTransaction.count({
          where: { txHash: body.txHash, state: "PENDING", work: { deploymentId: id } },
        });
        const historical = await tx.signedTransaction.findFirst({
          where: {
            deploymentId: id,
            txHash: body.txHash,
            OR: [{ outcome: null }, { outcome: { in: ["RECEIVED", "ACCEPTED", "UNRESOLVED"] } }],
          },
        });
        const row = await tx.deployment.findUniqueOrThrow({ where: { id } });
        const deployHash = await deploymentSubmissionHash(tx, row);
        // A worker may have recorded finality before crashing during deployment
        // metadata recovery. Allow verified recovery of that same success only.
        const successfulDeploymentRecovery =
          body.outcome === "SUCCESS" &&
          deployHash === body.txHash &&
          ["BUILDING", "SUBMITTED", "FAILED"].includes(row.status) &&
          (await tx.serviceTransaction.count({
            where: { txHash: body.txHash, state: "SUCCESS", work: { deploymentId: id } },
          })) > 0;
        if (!pending && !historical && !successfulDeploymentRecovery)
          throw new AppError("NOT_FOUND", "Unresolved transaction not found");
        if (
          deployHash === body.txHash &&
          ["BUILDING", "SUBMITTED", "FAILED"].includes(row.status)
        ) {
          const references = body.outcome === "SUCCESS" ? recoveredDeploymentReferences(row) : null;
          await tx.deployment.update({
            where: { id },
            data:
              body.outcome === "SUCCESS"
                ? {
                    status: "CONFIRMED",
                    deployTxHash: body.txHash,
                    ...references,
                    confirmedAt: new Date(),
                  }
                : {
                    status: "FAILED",
                    deployTxHash: body.txHash,
                    errorMessage: "Verified transaction failure",
                  },
          });
        }
        await tx.serviceTransaction.updateMany({
          where: { txHash: body.txHash, state: "PENDING", work: { deploymentId: id } },
          data: { state: body.outcome, ledger: body.ledger },
        });
        if (historical)
          await tx.signedTransaction.update({
            where: { id: historical.id },
            data: {
              outcome: body.outcome === "SUCCESS" ? "CONFIRMED" : "FAILED",
              ledger: body.ledger,
              nextCheckAt: null,
            },
          });
      } else if (body.kind === "streamer") {
        if (
          (await tx.deploymentWork.count({ where: { deploymentId: id, state: "OPEN" } })) ||
          (await tx.serviceTransaction.count({
            where: { work: { deploymentId: id }, state: "PENDING" },
          }))
        )
          throw new AppError(
            "CONFLICT",
            "Fence workers and verify transaction finality before reconciling a claim",
          );
        const claim = await tx.streamerClaimJob.findFirst({
          where: { id: body.id, deploymentId: id, status: "RUNNING" },
        });
        if (!claim) throw new AppError("NOT_FOUND", "Unresolved claim not found");
        await tx.streamerClaimJob.update({
          where: { id: claim.id },
          data: {
            status: body.outcome,
            ...(body.outcome === "CLAIMED" ? { claimedAt: new Date() } : {}),
            lastError: "Verified retirement settlement; see audit evidence",
          },
        });
      } else if (body.kind === "events") {
        const row = await tx.deployment.findUniqueOrThrow({ where: { id } });
        if (
          (!row.retirementCoverageGap && !row.retirementBlocker?.startsWith("Event coverage")) ||
          row.retirementCutoffLedger !== body.cutoffLedger
        )
          throw new AppError("CONFLICT", "Verification must match the blocked event cutoff");
        // Operator must reconcile archived events and persist every committed
        // payout/dead-letter obligation before attesting coverage.
        await tx.deployment.update({
          where: { id },
          data: { retirementCoverageGap: null, retirementReconciledAt: new Date() },
        });
      } else if (body.kind === "work") {
        const work = await tx.deploymentWork.findFirst({
          where: { id: body.id, deploymentId: id, state: { not: "DONE" } },
        });
        if (!work) throw new AppError("NOT_FOUND", "Unresolved work not found");
        if (await tx.serviceTransaction.count({ where: { workId: work.id, state: "PENDING" } }))
          throw new AppError(
            "CONFLICT",
            "Reconcile transaction finality before verifying work completion",
          );
        await tx.deploymentWork.update({
          where: { id: work.id },
          data: { state: "DONE", completedAt: new Date(), reconciliationEvidence: body.evidence },
        });
      } else {
        const job = await tx.offRampPayoutJob.findFirst({
          where: {
            id: body.id,
            deploymentId: id,
            status: { in: ["FAILED", "CANCELLED", "RUNNING"] },
            settlementResolvedAt: null,
          },
        });
        if (!job) throw new AppError("NOT_FOUND", "Unresolved payout not found");
        if (
          (await tx.deploymentWork.count({
            where: { deploymentId: id, state: { in: ["OPEN", "BLOCKED"] } },
          })) ||
          (await tx.serviceTransaction.count({
            where: { work: { deploymentId: id }, state: "PENDING" },
          }))
        )
          throw new AppError(
            "CONFLICT",
            "Fence workers and reconcile transaction finality before verifying payout recovery",
          );
        await tx.offRampPayoutJob.update({
          where: { id: job.id },
          data: {
            ...(job.status === "RUNNING"
              ? { status: "CANCELLED" as const, cancelledAt: new Date() }
              : {}),
            settlementResolvedAt: new Date(),
            settlementEvidence: body.evidence,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          action: "DEPLOY_SETTLEMENT_VERIFIED",
          userId: user.id,
          metadata: {
            deploymentId: id,
            kind: body.kind,
            recordId:
              body.kind === "events" ? id : body.kind === "transaction" ? body.txHash : body.id,
            evidence: body.evidence,
          },
        },
      });
    });
    return NextResponse.json({ data: { verified: true } });
  });
}
