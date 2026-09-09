import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { withErrorHandler } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { QuoteQuerySchema } from "@/lib/soroswap/quote";
import { readSoroswapQuote } from "@/lib/stellar/soroswap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Live Soroswap quote for the builder's swap preview (Instawards D1, #391).
 * Read-only simulation against the router pinned by env; never cached at the
 * framework layer. Returns stroops as strings.
 */
export async function GET(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    await enforceRateLimit({
      key: `soroswap:quote:${user.id}`,
      limit: 60,
      windowSeconds: 60,
      message: "Too many quote requests",
    });

    const q = QuoteQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const data = await readSoroswapQuote(q);
    return NextResponse.json({ data });
  });
}
