import { NextResponse } from "next/server";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { SubscriptionControlReconcileSchema } from "@/lib/api/v1/schema";
import { reconcileControlIntent } from "@/lib/api/v1/control-intent";
import { linkApiTransaction } from "@/lib/api/request-history/context";

export const dynamic = "force-dynamic";
export const POST = v1Route(
  { rateLimit: V1_RATE_LIMITS.subscriptionControlReconcile },
  async ({ deployment, req }) => {
    const body = SubscriptionControlReconcileSchema.parse(await req.json());
    const intent = await reconcileControlIntent(body.intent, deployment.id, "subscription.cancel");
    linkApiTransaction(intent.txHash);
    const data = {
      intent: intent.id,
      txHash: intent.txHash,
      action: intent.action,
      state: intent.state,
      ledger: intent.ledger,
      replacementAllowed: ["SUCCESS", "FAILED", "EXPIRED"].includes(intent.state),
    };
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  },
);
