import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { PayoutPrepareSchema } from "@/lib/api/v1/schema";
import { preparePayout } from "@/lib/api/v1/payouts";
import { clientIp } from "@/lib/rate-limit";

export const POST = v1Route(
  { rateLimit: V1_RATE_LIMITS.payouts },
  async ({ req, token, deployment }) => {
    const input = PayoutPrepareSchema.parse(
      await req.json().catch(() => {
        throw new AppError("VALIDATION", "Request body must be valid JSON");
      }),
    );
    return NextResponse.json({
      data: await preparePayout(deployment, token.id, input, clientIp(req)),
    });
  },
);
