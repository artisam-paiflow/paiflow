import { NextResponse } from "next/server";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { ScheduleStateQuerySchema, scheduleState } from "@/lib/api/v1/schedule";
export const dynamic = "force-dynamic";
export const GET = v1Route(
  { rateLimit: V1_RATE_LIMITS.scheduleState },
  async ({ req, deployment }) => {
    const query = ScheduleStateQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return NextResponse.json(
      { data: await scheduleState(deployment, query.nodeId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
);
