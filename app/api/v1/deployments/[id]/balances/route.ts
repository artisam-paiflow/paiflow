import { NextResponse } from "next/server";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { getPartnerBalances } from "@/lib/stellar/partner-balances";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = v1Route(
  { operation: "GET balances", rateLimit: V1_RATE_LIMITS.balances },
  async ({ deployment }) =>
    NextResponse.json(
      { data: await getPartnerBalances(deployment) },
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    ),
);
