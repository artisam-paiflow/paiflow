import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/errors";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { allowanceHasExpired } from "@/lib/stellar/allowance-status";
import { readAllowanceIntent } from "@/lib/subscription/intent";
import { AllowanceDeploymentIdSchema, AllowanceStatusSchema } from "@/lib/subscription/schema";
import { GET as transactionStatus } from "@/app/api/deployments/[id]/tx-status/route";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const id = AllowanceDeploymentIdSchema.parse((await ctx.params).id);
    await enforceRateLimit({
      key: `subscription-allowance-status:${clientIp(req)}`,
      limit: 60,
      windowSeconds: 60,
    });
    const query = AllowanceStatusSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    // Expired submit intents remain usable for read-only reconciliation.
    const intent = readAllowanceIntent(query.intent, id);
    if (await allowanceHasExpired(intent))
      return NextResponse.json({
        data: {
          txHash: intent.txHash,
          status: "FAILED",
          errorMessage: "Approval expired without confirmation",
        },
      });
    // Reuse confirmation attribution and safe event ingestion for known hashes.
    const url = req.nextUrl.clone();
    url.pathname = `/api/deployments/${id}/tx-status`;
    url.search = `?txHash=${intent.txHash}`;
    return transactionStatus(new NextRequest(url, { headers: req.headers }), ctx);
  });
}
