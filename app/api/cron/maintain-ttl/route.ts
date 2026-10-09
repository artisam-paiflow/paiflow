import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth/cron-secret";
import { withCronLease } from "@/lib/cron/lease";
import { env } from "@/lib/env";
import { withErrorHandler } from "@/lib/errors";
import { runTtlMaintenance, TTL_LIMITS } from "@/lib/stellar/ttl-maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    requireCronSecret(req);
    const lease = await withCronLease("maintain-ttl", TTL_LIMITS.ttlMs, runTtlMaintenance);
    return NextResponse.json({
      data: lease.acquired
        ? lease.value
        : {
            dryRun: !env().STELLAR_TTL_MAINTENANCE_ENABLED,
            deployments: 0,
            submissions: 0,
            truncated: false,
            budgetExhausted: false,
            moreDeployments: false,
            partialPipelines: false,
            details: [],
            failedDeployments: [],
            scans: [],
            leaseHeld: true,
          },
    });
  });
}
export const GET = POST;
