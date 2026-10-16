import { readScheduleJson } from "@/lib/api/v1/schedule";
import { NextResponse } from "next/server";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { SchedulePrepareSchema, prepareScheduleControl } from "@/lib/api/v1/schedule";
export const POST = v1Route(
  { operation: "POST schedule/resume", rateLimit: V1_RATE_LIMITS.schedulePrepare },
  async ({ req, deployment }) => {
    const body = SchedulePrepareSchema.parse(await readScheduleJson(req));
    return NextResponse.json({ data: await prepareScheduleControl(deployment, "resume", body) });
  },
);
