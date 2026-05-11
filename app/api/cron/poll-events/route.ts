import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError, withErrorHandler } from "@/lib/errors";
import { pollEventsFor } from "@/lib/stellar/events";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const secret = env().CRON_SECRET;
    if (secret && req.headers.get("x-cron-secret") !== secret) {
      throw new AppError("FORBIDDEN", "Bad cron secret");
    }
    const deployments = await db.deployment.findMany({
      where: { status: "CONFIRMED", contractAddress: { not: null } },
      select: { id: true },
      take: 100,
    });
    let total = 0;
    for (const d of deployments) {
      total += await pollEventsFor(d.id);
    }
    return NextResponse.json({ data: { polled: deployments.length, newEvents: total } });
  });
}

export const GET = POST;
