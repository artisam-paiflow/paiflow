import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { withErrorHandler } from "@/lib/errors";
import { analyticsContext } from "@/lib/analytics/context";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
export async function GET(req: NextRequest) {
  return withErrorHandler(async () => {
    await enforceRateLimit({
      key: `analytics-context:${clientIp(req)}`,
      limit: 120,
      windowSeconds: 60,
    });
    const user = await getSessionUser();
    return NextResponse.json({
      data: { ...(await analyticsContext(user?.id ?? null)), subject_id: user?.id ?? null },
    });
  });
}
