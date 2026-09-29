import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { rateLimit, clientIp, rateLimitSubject, CALLER_RATE_LIMITS } from "@/lib/rate-limit";
import { getWorkflowBalances } from "@/lib/stellar/balances";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const { perCaller, ipBackstop } = CALLER_RATE_LIMITS.balances;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // The address-wide bucket runs first and is not keyed on `id`, so varying
    // the id cannot buy a caller fresh buckets; it bounds the lookup below too.
    const ip = clientIp(req);
    const backstop = await rateLimit(
      `balances:backstop:${ip}`,
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
      include: {
        flow: { select: { templateKind: true } },
      },
    });
    if (!deployment) {
      throw new AppError("NOT_FOUND", "Deployment not found");
    }

    // Per deployment and user, after the ownership check, so a bucket is only
    // ever created for a deployment the caller owns (#725).
    const limit = await rateLimit(
      `balances:${id}:${rateLimitSubject(user, ip)}`,
      perCaller.limit,
      perCaller.windowSeconds,
    );
    if (!limit.ok) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    if (deployment.status !== "CONFIRMED" || !deployment.contractAddress) {
      return NextResponse.json({ totals: [], nodes: [] });
    }

    const { totals, nodes } = await getWorkflowBalances(deployment);

    return NextResponse.json({ totals, nodes });
  } catch (err) {
    return errorResponse(err);
  }
}
