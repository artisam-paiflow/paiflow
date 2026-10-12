import { readScheduleJson } from "@/lib/api/v1/schedule";
import { NextResponse } from "next/server";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { ScheduleReconcileSchema, reconcileScheduleControl } from "@/lib/api/v1/schedule";
export const POST = v1Route(
  { rateLimit: V1_RATE_LIMITS.scheduleReconcile },
  async ({ req, deployment }) => {
    const body = ScheduleReconcileSchema.parse(await readScheduleJson(req));
    return NextResponse.json({
      data: await reconcileScheduleControl(deployment, "resume", body.intent),
    });
  },
);
