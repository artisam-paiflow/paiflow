import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pollEventsFor } from "@/lib/stellar/events";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { rateLimit, clientIp, rateLimitSubject, CALLER_RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const { perCaller, ipBackstop } = CALLER_RATE_LIMITS.pollEvents;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // try/catch because the NOT_FOUND throws below used to escape the handler as
  // an unshaped 500; the success and 401/429 bodies are unchanged (#376).
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Address-wide first and not keyed on `id`, so varying the id cannot buy a
    // caller fresh buckets; it bounds the lookup below too.
    const ip = clientIp(req);
    const backstop = await rateLimit(
      `poll-events:backstop:${ip}`,
      ipBackstop.limit,
      ipBackstop.windowSeconds,
    );
    if (!backstop.ok) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    const { id } = await ctx.params;
    // Deployment.id is a Postgres uuid, so anything else would reach Prisma as
    // an invalid-input error (a 500) rather than a not-found.
    if (!z.string().uuid().safeParse(id).success) {
      throw new AppError("NOT_FOUND", "Deployment not found");
    }
    const deployment = await db.deployment.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true },
    });
    if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");

    // Per deployment and user, after the ownership check, so a bucket is only
    // ever created for a deployment the caller owns (#725).
    const limit = await rateLimit(
      `poll-events:${id}:${rateLimitSubject(user, ip)}`,
      perCaller.limit,
      perCaller.windowSeconds,
    );
    if (!limit.ok) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    const written = await pollEventsFor(deployment.id);

    const latestEvents = await db.contractEvent.findMany({
      where: { deploymentId: deployment.id },
      orderBy: [{ ledger: "desc" }, { eventId: "desc" }],
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
  } catch (err) {
    return errorResponse(err);
  }
}
