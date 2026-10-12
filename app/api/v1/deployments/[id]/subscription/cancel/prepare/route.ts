import { NextResponse } from "next/server";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { SubscriptionControlPrepareSchema } from "@/lib/api/v1/schema";
import { prepareSubscriptionControl } from "@/lib/api/v1/subscription-controls";

export const dynamic = "force-dynamic";
export const POST = v1Route(
  { rateLimit: V1_RATE_LIMITS.subscriptionControlPrepare },
  async ({ deployment, req }) => {
    const body = SubscriptionControlPrepareSchema.parse(await req.json());
    const data = await prepareSubscriptionControl(
      deployment,
      "subscription.cancel",
      body.walletAddress,
    );
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  },
);
