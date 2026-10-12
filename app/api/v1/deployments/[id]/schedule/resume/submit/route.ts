import { readScheduleJson } from "@/lib/api/v1/schedule";
import { NextResponse } from "next/server";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { clientIp } from "@/lib/rate-limit";
import { WalletControlSubmitSchema, submitScheduleControl } from "@/lib/api/v1/schedule";
export const POST = v1Route(
  { rateLimit: V1_RATE_LIMITS.scheduleSubmit },
  async ({ req, deployment, token }) => {
    const body = WalletControlSubmitSchema.parse(await readScheduleJson(req));
    return NextResponse.json({
      data: await submitScheduleControl({
        deployment,
        tokenId: token.id,
        action: "resume",
        ...body,
        ip: clientIp(req),
      }),
    });
  },
);
