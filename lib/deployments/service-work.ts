import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import type { Prisma, ServiceTransactionState } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

type WorkScope = {
  workId: string;
  deploymentId: string;
  externalPending: boolean;
  settlement: boolean;
  preparedDeployment?: { txHash: string; pipeline: Prisma.InputJsonValue };
  participants?: Array<{ workId: string; deploymentId: string }>;
};

// RPC clients survive Next development reloads; their callbacks must share the
// same process-owned context with newly loaded route modules.
const processContext = globalThis as typeof globalThis & {
  deploymentWorkContext?: AsyncLocalStorage<WorkScope>;
};
const context = (processContext.deploymentWorkContext ??= new AsyncLocalStorage<WorkScope>());

/** The same row lock serializes admission, retirement and settlement completion
 * across replicas. Never hold this database transaction over network I/O. */
export async function lockDeployment(tx: Prisma.TransactionClient, id: string) {
  if (!z.string().uuid().safeParse(id).success)
    throw new AppError("NOT_FOUND", "Deployment not found");
  const rows = await tx.$queryRaw<
    Array<{ id: string; serviceState: "ACTIVE" | "RETIRING" | "RETIRED" }>
  >`
    SELECT "id", "serviceState" FROM "Deployment" WHERE "id" = ${id}::uuid FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Deployment not found");
  return row;
}

export async function assertDeploymentService(id: string) {
  if (!z.string().uuid().safeParse(id).success)
    throw new AppError("NOT_FOUND", "Deployment not found");
  const row = await db.deployment.findUnique({ where: { id }, select: { serviceState: true } });
  if (!row || row.serviceState === "RETIRED")
    throw new AppError("NOT_FOUND", "Deployment not found");
  if (row.serviceState !== "ACTIVE")
    throw new AppError(
      "CONFLICT",
      "Deployment retirement is in progress; new service work is closed",
    );
}

export async function withDeploymentWork<T>(
  id: string,
  kind: string,
  fn: () => Promise<T>,
  settlement = false,
  settlementJobId?: string,
): Promise<T> {
  // Nested/asynchronous work needs its own durable lifetime: an SSE response
  // can return before its initial poll finishes. Never borrow a completed scope.
  const work = await db.$transaction(async (tx) => {
    const row = await lockDeployment(tx, id);
    if (row.serviceState === "RETIRED") throw new AppError("NOT_FOUND", "Deployment not found");
    if (row.serviceState !== "ACTIVE" && !settlement)
      throw new AppError(
        "CONFLICT",
        "Deployment retirement is in progress; new service work is closed",
      );
    if (settlementJobId) {
      if (kind !== `offramp-settlement:${settlementJobId}`)
        throw new AppError("INTERNAL", "Off-ramp admission must be bound to its job");
      const job = await tx.offRampPayoutJob.findUnique({ where: { id: settlementJobId } });
      if (!job || job.deploymentId !== id)
        throw new AppError("NOT_FOUND", "Off-ramp job not found");
      const previous = await tx.deploymentWork.findMany({
        where: { deploymentId: id, kind: { in: [kind, "offramp-settlement"] } },
        include: { transactions: true },
      });
      // A stale worker is not proof that its money movement failed. Preserve
      // unknown outcomes and successful movements whose job checkpoint was lost.
      const ownHistory = previous.filter((work) => work.kind === kind);
      const unresolved = previous.some(
        (work) =>
          work.state !== "DONE" ||
          work.transactions.some(
            (transaction) =>
              transaction.state === "PENDING" ||
              (work.kind === kind &&
                transaction.state === "SUCCESS" &&
                !(
                  transaction.transport === "horizon" &&
                  job.pdaxDepositTxHash === transaction.txHash
                )),
          ),
      );
      // Pre-upgrade/crashed development workers may have no durable admission.
      // Do not invent evidence that an untracked RUNNING job is safe to repeat.
      if (unresolved || (job.status === "RUNNING" && ownHistory.length === 0))
        throw new AppError("CONFLICT", "Off-ramp job requires verified outcome reconciliation");
    }
    return tx.deploymentWork.create({ data: { deploymentId: id, kind } });
  });
  const scope = { workId: work.id, deploymentId: id, externalPending: false, settlement };
  return context.run(scope, async () => {
    try {
      return await fn();
    } finally {
      // A process crash leaves OPEN. Unknown submissions have separate durable
      // PENDING transaction records. An opaque external relayer needs manual proof.
      // Operator fencing must survive a stale callback unwinding its scope.
      await db.deploymentWork.updateMany({
        where: { id: work.id, state: "OPEN" },
        data: {
          state: scope.externalPending ? "BLOCKED" : "DONE",
          blocker: scope.externalPending
            ? "External relayer outcome requires verified reconciliation"
            : null,
          completedAt: new Date(),
        },
      });
      // Completed admissions with no submitted transaction carry no financial
      // or idempotency history. Remove them; crashed OPEN and external BLOCKED
      // admissions and every transaction-bearing admission remain durable.
      if (!scope.externalPending)
        await db.deploymentWork.deleteMany({
          where: { id: work.id, state: "DONE", transactions: { none: {} } },
        });
    }
  });
}

/** TTL pools reads/operations across deployments. Admit the bounded batch in
 * stable lock order so retirement cannot race an already-loaded target list. */
export async function withDeploymentBatch<T>(
  ids: string[],
  kind: string,
  fn: (admittedIds: string[]) => Promise<T>,
): Promise<T> {
  const participants = await db.$transaction(async (tx) => {
    const result: Array<{ workId: string; deploymentId: string }> = [];
    for (const id of [...new Set(ids)].sort()) {
      const row = await lockDeployment(tx, id);
      if (row.serviceState !== "ACTIVE") continue;
      const work = await tx.deploymentWork.create({ data: { deploymentId: id, kind } });
      result.push({ workId: work.id, deploymentId: id });
    }
    return result;
  });
  const first = participants[0];
  if (!first) return fn([]);
  const scope = { ...first, participants, externalPending: false, settlement: false };
  return context.run(scope, async () => {
    try {
      return await fn(participants.map((item) => item.deploymentId));
    } finally {
      const workIds = participants.map((item) => item.workId);
      await db.deploymentWork.updateMany({
        where: { id: { in: workIds }, state: "OPEN" },
        data: { state: "DONE", completedAt: new Date() },
      });
      await db.deploymentWork.deleteMany({
        where: { id: { in: workIds }, state: "DONE", transactions: { none: {} } },
      });
    }
  });
}

/** Batches may have loaded a deployment before retirement closed admission. */
export async function runDeploymentWork<T>(
  id: string,
  kind: string,
  fn: () => Promise<T>,
  settlement = false,
  settlementJobId?: string,
) {
  try {
    return await withDeploymentWork(id, kind, fn, settlement, settlementJobId);
  } catch (error) {
    if (error instanceof AppError && (error.code === "CONFLICT" || error.code === "NOT_FOUND"))
      return undefined;
    throw error;
  }
}

export function prepareServiceDeployment(txHash: string, pipeline: Prisma.InputJsonValue) {
  const scope = context.getStore();
  if (scope) scope.preparedDeployment = { txHash, pipeline };
}

export async function beforeServiceSubmission(txHash: string, transport: "rpc" | "horizon") {
  const scope = context.getStore();
  if (!scope) return; // Shared factory/template and other non-deployment operations.
  const pipeline =
    scope.preparedDeployment?.txHash === txHash ? scope.preparedDeployment.pipeline : undefined;
  await db.$transaction(async (tx) => {
    for (const participant of scope.participants ?? [
      { workId: scope.workId, deploymentId: scope.deploymentId },
    ]) {
      const row = await lockDeployment(tx, participant.deploymentId);
      const admission = await tx.deploymentWork.findUnique({
        where: { id: participant.workId },
        select: { state: true },
      });
      if (admission?.state !== "OPEN")
        throw new AppError("CONFLICT", "Deployment work was reconciled and fenced");
      if (row.serviceState === "RETIRED" || (row.serviceState === "RETIRING" && !scope.settlement))
        throw new AppError("CONFLICT", "Deployment retirement has closed transaction submission");
      if (pipeline !== undefined)
        await tx.deployment.update({
          where: { id: participant.deploymentId },
          data: { deployTxHash: txHash, pipelineSnapshot: pipeline },
        });
      await tx.serviceTransaction.upsert({
        where: { workId_txHash: { workId: participant.workId, txHash } },
        create: { workId: participant.workId, txHash, transport },
        update: { state: "PENDING", ledger: null },
      });
    }
  });
}
export async function observeServiceTransaction(
  txHash: string,
  state: ServiceTransactionState,
  ledger?: number,
  force = false,
) {
  if (!context.getStore() && !force) return;
  await db.serviceTransaction.updateMany({
    where: { txHash, state: "PENDING" },
    data: { state, ...(ledger === undefined ? {} : { ledger }) },
  });
}
export async function beforeExternalRelayer() {
  const scope = context.getStore();
  if (!scope) throw new AppError("INTERNAL", "External relayer needs durable admission");
  await db.$transaction(async (tx) => {
    const row = await lockDeployment(tx, scope.deploymentId);
    if (row.serviceState !== "ACTIVE")
      throw new AppError("CONFLICT", "Deployment retirement has closed relayer submission");
    const admission = await tx.deploymentWork.findUnique({
      where: { id: scope.workId },
      select: { state: true },
    });
    if (admission?.state !== "OPEN")
      throw new AppError("CONFLICT", "Deployment work was reconciled and fenced");
    await tx.deploymentWork.update({
      where: { id: scope.workId },
      data: { blocker: "External relayer outcome requires verified reconciliation" },
    });
  });
  scope.externalPending = true;
}
export async function observeExternalRelayer(txHash: string) {
  const scope = context.getStore();
  if (scope)
    await db.serviceTransaction.upsert({
      where: { workId_txHash: { workId: scope.workId, txHash } },
      create: { workId: scope.workId, txHash, transport: "rpc" },
      update: {},
    });
  if (scope) scope.externalPending = false;
}
