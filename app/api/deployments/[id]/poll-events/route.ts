import { NextRequest, NextResponse } from "next/server";
import { pollEventsFor } from "@/lib/stellar/events";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireSession().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const deployment = await db.deployment.findFirst({
    where: { id, ownerId: user.id },
    select: { id: true },
  });
  if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");

  const written = await pollEventsFor(deployment.id);

  const latestEvents = await db.contractEvent.findMany({
    where: { deploymentId: deployment.id },
    orderBy: { occurredAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    polled: written,
    events: latestEvents.map((e) => ({
      id: e.id,
      eventId: e.eventId,
      kind: e.kind,
      ledger: e.ledger,
      txHash: e.txHash,
      payload: e.payload,
      decodedData: e.decodedData,
      occurredAt: e.occurredAt.toISOString(),
    })),
  });
}
