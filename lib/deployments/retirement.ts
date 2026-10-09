import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { eventChannel, redis } from "@/lib/redis";
import { sorobanRpc, horizon } from "@/lib/stellar/client";
import { deploymentSubmissionHash, recoveredDeploymentReferences } from "./deployment-recovery";
import { pollEventsForWithOutcome, reconcileStoredCashOutObligations } from "@/lib/stellar/events";
import { lockDeployment, observeServiceTransaction, withDeploymentWork } from "./service-work";

const unresolvedSigned: Prisma.SignedTransactionWhereInput = {
  OR: [{ outcome: null }, { outcome: { in: ["RECEIVED", "ACCEPTED", "UNRESOLVED"] } }],
};

export async function requestRetirement(id: string, ownerId: string) {
  const row = await db.$transaction(async (tx) => {
    await lockDeployment(tx, id);
    const d = await tx.deployment.findFirst({ where: { id, ownerId } });
    if (!d || d.serviceState === "RETIRED") throw new AppError("NOT_FOUND", "Deployment not found");
    if (d.serviceState === "RETIRING") return d;
    const now = new Date();
    const updated = await tx.deployment.update({
      where: { id },
      data: {
        serviceState: "RETIRING",
        retirementRequestedAt: now,
        retirementBlocker: "Waiting for admitted work and transaction finality",
        chargeRelayerMode: "MANUAL",
        nextChargeAt: null,
      },
    });
    // Legacy deployments may have no SignedTransaction/finality tracking. A
    // business FAILED status can be an old timeout, never settlement proof.
    if (d.deployTxHash && ["BUILDING", "SUBMITTED", "FAILED"].includes(d.status)) {
      const known = await tx.serviceTransaction.findFirst({
        where: { txHash: d.deployTxHash, work: { deploymentId: id } },
      });
      if (!known)
        await tx.deploymentWork.create({
          data: {
            deploymentId: id,
            kind: "legacy-deployment-finality",
            state: "DONE",
            completedAt: now,
            transactions: { create: { txHash: d.deployTxHash, transport: "rpc" } },
          },
        });
    }
    // Future, unclaimed streaming automation has no submitted payment. RUNNING
    // jobs and every fiat payout remain obligations until verified resolution.
    await tx.streamerClaimJob.updateMany({
      where: { deploymentId: id, status: "PENDING" },
      data: { status: "CANCELLED", lastError: "Deployment permanently retiring" },
    });
    await tx.deploymentApiToken.updateMany({
      where: { deploymentId: id, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.auditLog.create({
      data: { action: "DEPLOY_RETIRE_REQUEST", userId: ownerId, metadata: { deploymentId: id } },
    });
    return updated;
  });
  await redis()
    ?.publish(eventChannel(id), JSON.stringify({ type: "service-retiring" }))
    .catch(() => {});
  return row;
}

/** No count is a settlement proof outside this lock. New settlement admissions
 * take the same lock; ordinary admissions have already been closed. */
async function settlementBlocker(tx: Prisma.TransactionClient, id: string): Promise<string | null> {
  const work = await tx.deploymentWork.findFirst({
    where: { deploymentId: id, state: { not: "DONE" } },
    orderBy: { createdAt: "asc" },
  });
  if (work)
    return `Work ${work.id}: ${work.blocker ?? "admitted operation has not finished; crashed workers require verified reconciliation"}`;
  const pending = await tx.serviceTransaction.findFirst({
    where: { work: { deploymentId: id }, state: "PENDING" },
  });
  if (pending)
    return `Transaction ${pending.txHash}: finality unknown; reconcile before retirement`;
  const signed = await tx.signedTransaction.findFirst({
    where: { deploymentId: id, ...unresolvedSigned },
  });
  if (signed) return `Transaction ${signed.txHash}: historical finality requires reconciliation`;
  const d = await tx.deployment.findUniqueOrThrow({ where: { id } });
  if (d.status === "SUBMITTED" || (d.status === "BUILDING" && d.deployTxHash))
    return "Deployment transaction finalization is still pending";
  if (d.status === "CONFIRMED" && d.deployTxHash && !d.contractAddress)
    return "Verified deployed contract reference must be recovered before event reconciliation";
  const job = await tx.offRampPayoutJob.findFirst({
    where: { deploymentId: id, status: { not: "COMPLETED" }, settlementResolvedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (job)
    return `Payout ${job.id}: ${job.status}; ${job.pdaxDepositTxHash ? "provider deposit needs verified payout or recovery" : "payout or refund must be verified"}`;
  const dead = await tx.cashOutJobFailure.findFirst({
    where: { deploymentId: id, retriedAt: null },
  });
  if (dead)
    return `Cash-out event ${dead.contractEventId}: committed payout has not been recovered`;
  const stream = await tx.streamerClaimJob.findFirst({
    where: { deploymentId: id, status: "RUNNING" },
  });
  if (stream) return `Streamer claim ${stream.id}: in-flight claim requires reconciliation`;
  return null;
}

async function reconcileFinality(id: string) {
  const deployment = await db.deployment.findUniqueOrThrow({ where: { id } });
  const deployHash = await deploymentSubmissionHash(db, deployment);
  const recoverDeployment =
    deployHash && ["BUILDING", "SUBMITTED", "FAILED"].includes(deployment.status);
  if (deployHash && !deployment.deployTxHash)
    await db.deployment.update({ where: { id }, data: { deployTxHash: deployHash } });
  const pending = await db.serviceTransaction.findMany({
    where: {
      work: { deploymentId: id },
      OR: [
        { state: "PENDING" },
        ...(recoverDeployment
          ? [
              {
                txHash: deployHash!,
                state: {
                  in: ["SUCCESS", "FAILED", "REJECTED"] as ("SUCCESS" | "FAILED" | "REJECTED")[],
                },
              },
            ]
          : []),
      ],
    },
    take: 20,
    orderBy: { createdAt: "asc" },
  });
  for (const row of pending) {
    if (
      recoverDeployment &&
      row.txHash === deployHash &&
      (row.state === "FAILED" || row.state === "REJECTED")
    ) {
      // A durable failure/rejection proves this submission created no contract.
      await db.deployment.updateMany({
        where: { id, serviceState: "RETIRING", deployTxHash: row.txHash },
        data: { status: "FAILED", errorMessage: "Verified transaction failure" },
      });
      continue;
    }
    if (row.transport === "horizon") {
      const got = await horizon().transactions().transaction(row.txHash).call();
      await observeServiceTransaction(
        row.txHash,
        got.successful ? "SUCCESS" : "FAILED",
        (await got.ledger()).sequence,
        true,
      );
    } else {
      const got = await sorobanRpc().getTransaction(row.txHash);
      if (got.status === "SUCCESS" || got.status === "FAILED") {
        // Retain deployed contract references without starting future automation.
        const deployment = await db.deployment.findUniqueOrThrow({ where: { id } });
        if (
          deployment.deployTxHash === row.txHash &&
          ["BUILDING", "SUBMITTED", "FAILED"].includes(deployment.status)
        ) {
          const references =
            got.status === "SUCCESS" ? recoveredDeploymentReferences(deployment, got) : null;
          await db.deployment.updateMany({
            where: { id, serviceState: "RETIRING", deployTxHash: row.txHash },
            data: references
              ? { status: "CONFIRMED", confirmedAt: new Date(), ...references }
              : { status: "FAILED", errorMessage: "Transaction failed on the network" },
          });
        }
        // Keep finality retryable until deployed references have been persisted.
        await observeServiceTransaction(row.txHash, got.status, got.ledger, true);
      }
    }
  }
  // Includes pre-migration hashes which the analytics reconciler intentionally
  // does not cover. NOT_FOUND is never treated as failed or settled.
  const signed = await db.signedTransaction.findMany({
    where: { deploymentId: id, ...unresolvedSigned },
    take: 20,
    orderBy: { createdAt: "asc" },
  });
  for (const row of signed) {
    const got = await sorobanRpc().getTransaction(row.txHash);
    if (got.status === "SUCCESS" || got.status === "FAILED") {
      await db.signedTransaction.update({
        where: { id: row.id },
        data: { outcome: got.status === "SUCCESS" ? "CONFIRMED" : "FAILED", ledger: got.ledger },
      });
    }
  }
}

export async function reconcileRetirement(id: string) {
  let d = await db.deployment.findUnique({ where: { id } });
  if (!d || d.serviceState !== "RETIRING") return;
  await db.deployment.update({ where: { id }, data: { retirementCheckedAt: new Date() } });
  try {
    await reconcileFinality(id);
    d = await db.deployment.findUniqueOrThrow({ where: { id } });
    // A recorded successful deployment can outlive a crash before its references
    // were saved. Do not turn missing RPC history into an empty deployment cutoff.
    const needsRecovery =
      d.deployTxHash &&
      ["BUILDING", "SUBMITTED", "FAILED"].includes(d.status) &&
      (d.status === "BUILDING" ||
        d.status === "SUBMITTED" ||
        (await db.serviceTransaction.count({
          where: { txHash: d.deployTxHash, work: { deploymentId: id }, state: "SUCCESS" },
        })) > 0);
    if (needsRecovery) {
      await db.deployment.update({
        where: { id },
        data: {
          retirementBlocker:
            "Deployment transaction finalization and contract reference recovery are still pending",
        },
      });
      return;
    }
    if (d.status === "CONFIRMED" && d.deployTxHash && !d.contractAddress) {
      await db.deployment.update({
        where: { id },
        data: {
          retirementBlocker:
            "Verified deployed contract reference must be recovered before event reconciliation",
        },
      });
      return;
    }
    if (d.status === "CONFIRMED") recoveredDeploymentReferences(d);
    // The ledger boundary is fixed exactly once, after pre-admitted operations
    // finish and their hashes reach finality. External activity after it cannot
    // extend the drain. Outstanding payout jobs do not change this boundary.
    if (d.retirementCutoffLedger === null) {
      const ready = await db.$transaction(async (tx) => {
        await lockDeployment(tx, id);
        const unfinished = await tx.deploymentWork.count({
          where: { deploymentId: id, state: { not: "DONE" } },
        });
        const pending = await tx.serviceTransaction.count({
          where: { work: { deploymentId: id }, state: "PENDING" },
        });
        const historical = await tx.signedTransaction.count({
          where: { deploymentId: id, ...unresolvedSigned },
        });
        return unfinished + pending + historical === 0;
      });
      if (ready) {
        const cutoff =
          d.contractAddress && (d.status === "CONFIRMED" || !!d.deployTxHash)
            ? (await sorobanRpc().getLatestLedger()).sequence
            : 0;
        await db.deployment.updateMany({
          where: { id, serviceState: "RETIRING", retirementCutoffLedger: null },
          data: { retirementCutoffLedger: cutoff },
        });
      }
    }
    const current = await db.deployment.findUniqueOrThrow({ where: { id } });
    if (current.retirementCoverageGap) {
      await db.deployment.update({
        where: { id },
        data: { retirementBlocker: current.retirementCoverageGap },
      });
      return;
    }
    if (current.retirementCutoffLedger !== null && !current.retirementReconciledAt) {
      if (
        (!current.contractAddress || (!current.deployTxHash && current.status !== "CONFIRMED")) &&
        current.status !== "SUBMITTED"
      ) {
        await db.deployment.update({ where: { id }, data: { retirementReconciledAt: new Date() } });
      } else {
        const coverage = await withDeploymentWork(
          id,
          "retirement-event-reconciliation",
          () => pollEventsForWithOutcome(id, { retirementCutoff: current.retirementCutoffLedger! }),
          true,
        );
        if (
          coverage.status === "complete" &&
          coverage.scannedThrough !== null &&
          coverage.scannedThrough >= current.retirementCutoffLedger
        ) {
          await db.deployment.update({
            where: { id },
            data: { retirementReconciledAt: new Date() },
          });
        } else {
          await db.deployment.update({
            where: { id },
            data: {
              retirementBlocker: `Event coverage through ledger ${current.retirementCutoffLedger} incomplete: ${coverage.reasons.join(", ")}`,
              ...(coverage.reasons.includes("retention-gap")
                ? {
                    retirementCoverageGap: `Event coverage before ledger ${current.retirementCutoffLedger} has a retention gap; verified archival reconciliation is required`,
                  }
                : {}),
            },
          });
          return;
        }
      }
    }
    if (current.retirementCutoffLedger !== null) {
      const covered = await withDeploymentWork(
        id,
        "retirement-cash-out-recovery",
        () => reconcileStoredCashOutObligations(id, current.retirementCutoffLedger!),
        true,
      );
      if (!covered) {
        await db.deployment.updateMany({
          where: { id, serviceState: "RETIRING" },
          data: {
            retirementBlocker: "Pre-cutoff cash-out obligations still require bounded recovery",
          },
        });
        return;
      }
    }
    await db.$transaction(async (tx) => {
      const state = await lockDeployment(tx, id);
      if (state.serviceState !== "RETIRING") return;
      const blocker = await settlementBlocker(tx, id);
      const latest = await tx.deployment.findUniqueOrThrow({ where: { id } });
      if (blocker || latest.retirementCoverageGap || !latest.retirementReconciledAt) {
        await tx.deployment.update({
          where: { id },
          data: {
            retirementBlocker:
              blocker ??
              latest.retirementCoverageGap ??
              "Waiting to establish and reconcile the ledger cutoff",
          },
        });
        return;
      }
      await tx.deployment.update({
        where: { id },
        data: { serviceState: "RETIRED", retiredAt: new Date(), retirementBlocker: null },
      });
      await tx.auditLog.create({
        data: {
          action: "DEPLOY_RETIRED",
          userId: latest.ownerId,
          metadata: { deploymentId: id, cutoffLedger: latest.retirementCutoffLedger },
        },
      });
    });
  } catch (error) {
    const obligation =
      error instanceof AppError &&
      (error.message.startsWith("Cash-out event ") ||
        error.message.startsWith("Legacy cash-out obligation") ||
        error.message.startsWith("Ambiguous payroll cash-out"))
        ? error.message
        : null;
    // Fixed text: provider errors can contain credentials and raw envelopes.
    await db.deployment.updateMany({
      where: { id, serviceState: "RETIRING" },
      data: {
        retirementBlocker:
          obligation ??
          "Reconciliation unavailable; transaction/event finality requires verified recovery",
      },
    });
    log.warn({ deploymentId: id }, "retirement reconciliation blocked");
  }
}

export async function reconcileRetirements() {
  const rows = await db.deployment.findMany({
    where: { serviceState: "RETIRING", network: env().STELLAR_NETWORK },
    orderBy: [{ retirementCheckedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    take: 10,
    select: { id: true },
  });
  const started = Date.now();
  let checked = 0;
  for (const row of rows) {
    if (Date.now() - started > 15_000) break;
    await reconcileRetirement(row.id);
    checked++;
  }
  return { checked, truncated: checked < rows.length };
}
