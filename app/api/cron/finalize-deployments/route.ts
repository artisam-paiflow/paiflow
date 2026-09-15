import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError, withErrorHandler } from "@/lib/errors";
import { captureServer } from "@/lib/analytics/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const secret = env().CRON_SECRET;
    if (secret && req.headers.get("x-cron-secret") !== secret) {
      throw new AppError("FORBIDDEN", "Bad cron secret");
    }
    // Mark stuck SUBMITTED deployments as FAILED after 5 minutes (submit() handles the common case).
    const cutoff = new Date(Date.now() - 5 * 60_000);
    // Read the rows first so each timeout can be attributed to its owner; the
    // update re-checks the status, so a deployment confirmed in between is kept.
    const stuck = await db.deployment.findMany({
      where: { status: "SUBMITTED", createdAt: { lt: cutoff } },
      select: { id: true, ownerId: true, flowId: true },
    });
    const updated = await db.deployment.updateMany({
      where: { id: { in: stuck.map((d) => d.id) }, status: "SUBMITTED" },
      data: { status: "FAILED", errorMessage: "Timed out before finality" },
    });
    await Promise.all(
      stuck.map((d) =>
        captureServer(d.ownerId, "deploy_failed", {
          stage: "finality_timeout",
          error_class: "timeout",
          error_code: null,
          flow_id: d.flowId,
          deployment_id: d.id,
        }),
      ),
    );
    return NextResponse.json({ data: { failed: updated.count } });
  });
}

export const GET = POST;
