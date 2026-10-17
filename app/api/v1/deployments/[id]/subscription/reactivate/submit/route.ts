import { NextResponse } from "next/server";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { WalletControlSubmitSchema } from "@/lib/api/v1/control-intent";
import { submitSubscriptionControl } from "@/lib/api/v1/subscription-controls";

export const dynamic = "force-dynamic";
export const POST = v1Route(
  {
    operation: "POST subscription/reactivate/submit",
    rateLimit: V1_RATE_LIMITS.subscriptionControlSubmit,
  },
  async ({ deployment, req, token, tokenType }) => {
    const body = WalletControlSubmitSchema.parse(await req.json());
    const data = await submitSubscriptionControl({
      deployment,
      action: "subscription.reactivate",
      ...body,
      tokenId: token.id,
      tokenType,
      req,
    });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  },
);
