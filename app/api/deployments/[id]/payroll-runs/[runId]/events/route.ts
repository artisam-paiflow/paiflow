import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireDevAuth } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { FeedQuerySchema, FeedResponseSchema, paginate } from "@/lib/payroll/event-feed";
import { loadPayrollEvents } from "@/lib/payroll/event-feed-source";

/**
 * Event feed scoped to a single payroll run. Same synthesized timeline as the
 * deployment-level feed, filtered to the run's own rows (its payouts and their
 * off-ramp jobs). 404s if the run does not belong to the deployment.
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
      select: { id: true },
    });
    if (!run) throw new AppError("NOT_FOUND", "Payroll run not found");

    const q = FeedQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

    const events = await loadPayrollEvents(deployment.id, run.id);

    let page;
    try {
      page = paginate(events, q.cursor, q.limit);
    } catch {
      throw new AppError("VALIDATION", "Invalid cursor");
    }

    return NextResponse.json(FeedResponseSchema.parse(page));
  });
}
