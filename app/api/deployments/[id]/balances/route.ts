import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deploymentServiceRoute } from "@/lib/deployments/service-route";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import {
  rateLimit,
  clientIp,
  rateLimitSubject,
  CALLER_RATE_LIMITS,
  retryAfterSeconds,
} from "@/lib/rate-limit";
import { getDashboardBalances } from "@/lib/stellar/dashboard-balance-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const { perCaller, ipBackstop } = CALLER_RATE_LIMITS.balances;

async function GETHandler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
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
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds(backstop)) } },
      );
    }

    const { id } = await ctx.params;
    // Deployment.id is a Postgres uuid, so anything else would reach Prisma as
    // an invalid-input error (a 500) rather than a not-found.
    if (!z.string().guid({ error: "Invalid uuid" }).safeParse(id).success) {
      throw new AppError("NOT_FOUND", "Deployment not found");
    }
    const deployment = await db.deployment.findFirst({
      where: { id, ownerId: user.id },
      select: {
        id: true,
        ownerId: true,
        status: true,
        graphSnapshot: true,
        pipelineSnapshot: true,
        contractAddress: true,
        sourceAccount: true,
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
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds(limit)) } },
      );
    }

    if (deployment.status !== "CONFIRMED" || !deployment.contractAddress) {
      return NextResponse.json(
        { totals: [], nodes: [] },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const balances = await getDashboardBalances(deployment);

    return NextResponse.json(balances, { headers: { "Cache-Control": "private, no-store" } });
  });
}

export const GET = deploymentServiceRoute(GETHandler, "owner");
