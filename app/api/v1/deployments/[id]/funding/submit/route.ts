import { NextResponse } from "next/server";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { fundingBody } from "@/lib/api/v1/funding-body";
import { FundingSubmitSchema } from "@/lib/api/v1/funding-schema";
import { assertFundingEligible } from "@/lib/api/v1/funding";
import { submitControlIntent } from "@/lib/api/v1/control-submission";
import { clientIp } from "@/lib/rate-limit";
export const POST = v1Route(
  { operation: "POST funding/submit", rateLimit: V1_RATE_LIMITS.fundingSubmit },
  async ({ req, deployment, token, tokenType }) => {
    const input = FundingSubmitSchema.parse(await fundingBody(req));
    return NextResponse.json(
      {
        data: await submitControlIntent({
          deployment,
          tokenId: token.id,
          tokenType,
          ...input,
          ip: clientIp(req),
          assertEligible: () => assertFundingEligible(deployment, input.intent, input.action),
        }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
);
