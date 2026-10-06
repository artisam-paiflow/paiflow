import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth/cron-secret";
import { withErrorHandler } from "@/lib/errors";
import { CRON_LIMITS } from "@/lib/cron/config";
import { withCronLease } from "@/lib/cron/lease";
import { reconcileTransactions } from "@/lib/stellar/reconcile-transactions";
import { deliverOutbox } from "@/lib/analytics/outbox";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    requireCronSecret(req);
    const result = await withCronLease(
      "reconcile-transactions",
      CRON_LIMITS.reconcileTransactions.ttlMs,
      async () => {
        const outcomes = await reconcileTransactions();
        const analytics = await deliverOutbox(CRON_LIMITS.analyticsDelivery);
        return { ...outcomes, analytics };
      },
    );
    return NextResponse.json({
      data: result.acquired
        ? result.value
        : { checked: 0, confirmed: 0, failed: 0, unresolved: 0, leaseHeld: true },
    });
  });
}
export const GET = POST;
