import { linkApiTransaction } from "@/lib/api/request-history/context";
import { NextResponse } from "next/server";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { fundingBody } from "@/lib/api/v1/funding-body";
import { FundingReconcileSchema } from "@/lib/api/v1/funding-schema";
import { reconcileControlIntent } from "@/lib/api/v1/control-intent";
export const POST = v1Route(
  { rateLimit: V1_RATE_LIMITS.fundingSubmit },
  async ({ req, deployment }) => {
    const input = FundingReconcileSchema.parse(await fundingBody(req));
    const intent = await reconcileControlIntent(input.intent, deployment.id, input.action);
    linkApiTransaction(intent.txHash);
    return NextResponse.json(
      {
        data: {
          intent: intent.id,
          action: intent.action,
          txHash: intent.txHash,
          network: intent.network,
          state: intent.state,
          expiresAt: new Date(Number(intent.maxTime) * 1000).toISOString(),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
);
