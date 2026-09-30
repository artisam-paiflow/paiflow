import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/errors";
import { log } from "@/lib/log";
import { requireCronSecret } from "@/lib/auth/cron-secret";
import { CRON_LIMITS } from "@/lib/cron/config";
import { CRON_SKIPPED_REASON, withCronLease } from "@/lib/cron/lease";
import { runAutoRelease } from "@/lib/timelock-release";

export const dynamic = "force-dynamic";

// Sandbox-owned deployments are never loaded: a sandbox session cannot deploy
// a TIMELOCK (SANDBOX_TEMPLATE_KINDS), and this job signs with the relayer,
// which must never act on a sandbox pipeline. lib/timelock-release.ts filters
// them out of both discovery and selection.
export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    requireCronSecret(req);
    const lease = await withCronLease("auto-release", CRON_LIMITS.autoRelease.ttlMs, () =>
      runAutoRelease(),
    );
    if (!lease.acquired) {
      log.info("auto-release cron skipped: previous run still active");
      return NextResponse.json({ data: { skipped: CRON_SKIPPED_REASON } });
    }
    return NextResponse.json({ data: lease.value });
  });
}

export const GET = POST;
