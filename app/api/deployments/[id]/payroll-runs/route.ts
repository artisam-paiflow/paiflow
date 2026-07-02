import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireDevAuth } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import {
  RunListResponseSchema,
  countCompletedPayouts,
  type PayoutForSerialize,
} from "@/lib/payroll/run-serialize";

const Query = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** A malformed (non-UUID) id can't match any row; treat it as not-found rather
 * than letting it reach Prisma and surface as a generic 500. */
const isUuid = (v: string) => z.string().uuid().safeParse(v).success;

/**
 * List a deployment's payroll runs, newest first, with per-run payout counts.
 *
 * Cursor-based pagination on (createdAt, id): pass the returned `nextCursor`
 * back as `?cursor=` to fetch the next page.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { user } = await requireDevAuth(req);
    const { id } = await ctx.params;
    if (!isUuid(id)) throw new AppError("NOT_FOUND", "Deployment not found");

    const deployment = await db.deployment.findFirst({
      where: user ? { id, ownerId: user.id } : { id },
      select: { id: true },
    });
    if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");

    const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));

    const runs = await db.payrollRun.findMany({
      where: { deploymentId: deployment.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      include: {
        payouts: {
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

    const nextCursor = runs.length > q.limit ? runs.pop()!.id : null;

    const data = runs.map((run) => {
      const payouts = run.payouts as PayoutForSerialize[];
      return {
        id: run.id,
        status: run.status,
        totalStroops: run.totalStroops,
        triggeredAt: run.runAt?.toISOString() ?? null,
        chargedAt: run.chargedAt?.toISOString() ?? null,
        txHash: run.txHash,
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
        payoutCount: payouts.length,
        completedPayoutCount: countCompletedPayouts(payouts),
      };
    });

    return NextResponse.json(RunListResponseSchema.parse({ data, nextCursor }));
  });
}
