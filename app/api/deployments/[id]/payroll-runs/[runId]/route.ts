import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireDevAuth } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import {
  RunDetailResponseSchema,
  serializePayout,
  type PayoutForSerialize,
} from "@/lib/payroll/run-serialize";

/**
 * Return a single payroll run with its per-payout status, including off-ramp
 * job progress. 404s if the run does not belong to the given deployment.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; runId: string }> },
) {
  return withErrorHandler(async () => {
    const { user } = await requireDevAuth(req);
    const { id, runId } = await ctx.params;

    const deployment = await db.deployment.findFirst({
      where: user ? { id, ownerId: user.id } : { id },
      select: { id: true },
    });
    if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");

    const run = await db.payrollRun.findFirst({
      where: { id: runId, deploymentId: deployment.id },
      include: {
        payouts: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            employeeId: true,
            amountStroops: true,
            txHash: true,
            employee: { select: { label: true, address: true, payoutMode: true } },
            offRampJobs: {
              select: { status: true, lastError: true, completedAt: true },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
    });
    if (!run) throw new AppError("NOT_FOUND", "Payroll run not found");

    const body = {
      id: run.id,
      status: run.status,
      totalStroops: run.totalStroops,
      triggeredAt: run.runAt?.toISOString() ?? null,
      chargedAt: run.chargedAt?.toISOString() ?? null,
      txHash: run.txHash,
      errorMessage: run.lastError,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
      payouts: (run.payouts as PayoutForSerialize[]).map(serializePayout),
    };

    return NextResponse.json(RunDetailResponseSchema.parse(body));
  });
}
