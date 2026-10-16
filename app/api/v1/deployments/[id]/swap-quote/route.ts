import { NextResponse } from "next/server";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { SwapQuoteQuerySchema } from "@/lib/api/v1/swap-quote-schema";
import { deploymentSwapQuote } from "@/lib/api/v1/swap-quote";

export const dynamic = "force-dynamic";
export const GET = v1Route(
  { operation: "GET swap-quote", rateLimit: V1_RATE_LIMITS.swapQuote },
  async ({ req, deployment }) => {
    const query = SwapQuoteQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return NextResponse.json(
      { data: await deploymentSwapQuote(deployment, query) },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
);
