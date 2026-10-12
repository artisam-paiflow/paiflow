import { NextResponse } from "next/server";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { fundingBody } from "@/lib/api/v1/funding-body";
import { FundingPrepareSchema } from "@/lib/api/v1/funding-schema";
import { discoverFunding, prepareFunding } from "@/lib/api/v1/funding";
export const dynamic = "force-dynamic";
export const GET = v1Route({ rateLimit: V1_RATE_LIMITS.funding }, async ({ deployment }) =>
  NextResponse.json(
    { data: await discoverFunding(deployment) },
    { headers: { "Cache-Control": "no-store" } },
  ),
);
export const POST = v1Route({ rateLimit: V1_RATE_LIMITS.funding }, async ({ req, deployment }) =>
  NextResponse.json(
    { data: await prepareFunding(deployment, FundingPrepareSchema.parse(await fundingBody(req))) },
    { headers: { "Cache-Control": "no-store" } },
  ),
);
