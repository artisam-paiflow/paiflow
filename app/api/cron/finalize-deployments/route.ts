import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withErrorHandler } from "@/lib/errors";
import { captureServer } from "@/lib/analytics/server";
import { requireCronSecret } from "@/lib/auth/cron-secret";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    requireCronSecret(req);
    // Mark stuck SUBMITTED deployments as FAILED after 5 minutes (submit() handles the common case).
    const cutoff = new Date(Date.now() - 5 * 60_000);
    // Read the rows first so each timeout can be attributed to its owner. Each
    // update re-checks the status, so a deployment confirmed in between is kept
    // and, because its count is 0, not reported as a failure either.
    const stuck = await db.deployment.findMany({
      where: { status: "SUBMITTED", createdAt: { lt: cutoff } },
      select: { id: true, ownerId: true, flowId: true },
    });
    const counts = await Promise.all(
      stuck.map(async (d) => {
        const { count } = await db.deployment.updateMany({
          where: { id: d.id, status: "SUBMITTED" },
          data: { status: "FAILED", errorMessage: "Timed out before finality" },
        });
        if (count === 1) {
          await captureServer(d.ownerId, "deploy_failed", {
            stage: "finality_timeout",
            error_class: "timeout",
            error_code: null,
            flow_id: d.flowId,
            deployment_id: d.id,
          });
        }
        return count;
      }),
    );
    return NextResponse.json({ data: { failed: counts.reduce((a, b) => a + b, 0) } });
  });
}

export const GET = POST;
