import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { AppError, withErrorHandler } from "@/lib/errors";
import { pollEventsFor } from "@/lib/stellar/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    log.info("poll-events cron started");
    const secret = env().CRON_SECRET;
    if (secret && req.headers.get("x-cron-secret") !== secret) {
      log.warn("poll-events cron forbidden: bad secret");
      throw new AppError("FORBIDDEN", "Bad cron secret");
    }

    const deployments = await db.deployment.findMany({
      where: { status: "CONFIRMED" },
      select: { id: true },
    });
    log.info({ deploymentCount: deployments.length }, "poll-events cron found deployments");

    let polled = 0;
    let written = 0;
    const errors: Array<{ deploymentId: string; error: string }> = [];

    for (const d of deployments) {
      try {
        const count = await pollEventsFor(d.id);
        polled += 1;
        written += count;
        if (count > 0) {
          log.info({ deploymentId: d.id, written: count }, "poll-events cron wrote events");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ deploymentId: d.id, err }, "poll-events cron failed for deployment");
        errors.push({ deploymentId: d.id, error: message });
      }
    }

    log.info(
      { polled, written, deploymentCount: deployments.length, errorCount: errors.length },
      "poll-events cron finished",
    );

    return NextResponse.json({
      data: { polled, written, errors: errors.length, deployments: deployments.length },
    });
  });
}

export const GET = POST;
