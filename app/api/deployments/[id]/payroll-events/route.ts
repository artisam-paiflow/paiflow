import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireDevAuth } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { FeedQuerySchema, FeedResponseSchema, paginate } from "@/lib/payroll/event-feed";
import { loadPayrollEvents } from "@/lib/payroll/event-feed-source";

/**
 * Live-style event feed for a deployment's payroll activity.
 *
 * Returns a merged, newest-first timeline synthesized from `PayrollRun`,
 * `PayrollPayout`, and `OffRampPayoutJob` rows. Cursor-based pagination on
 * (occurredAt, id): pass the returned `nextCursor` back as `?cursor=`.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { user } = await requireDevAuth(req);
    const { id } = await ctx.params;

    const deployment = await db.deployment.findFirst({
      where: user ? { id, ownerId: user.id } : { id },
      select: { id: true },
    });
    if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");

    const q = FeedQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

    const events = await loadPayrollEvents(deployment.id, undefined, q.limit, q.cursor);

    let page;
    try {
      page = paginate(events, q.cursor, q.limit);
    } catch {
      throw new AppError("VALIDATION", "Invalid cursor");
    }

    return NextResponse.json(FeedResponseSchema.parse(page));
  });
}
