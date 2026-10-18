import { NextResponse } from "next/server";
import { z } from "zod";
import { linkApiTransaction } from "@/lib/api/request-history/context";
import { withInteractiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { getTransactionStatus } from "@/lib/api/v1/transaction-status";

export const GET = v1Route<{ id: string; txHash: string }>(
  {
    operation: "GET transactions/:txHash",
    rateLimit: V1_RATE_LIMITS.transactions,
    rateLimitRoute: "/api/v1/deployments/:id/transactions/:txHash",
  },
  async ({ params, deployment }) =>
    withInteractiveRpcBudget(async () => {
      const txHash = z
        .string()
        .regex(/^[0-9a-fA-F]{64}$/)
        .parse(params.txHash)
        .toLowerCase();
      const data = await getTransactionStatus(deployment, txHash);
      linkApiTransaction(txHash);
      return NextResponse.json(
        { data },
        {
          headers: { "Cache-Control": "no-store" },
        },
      );
    }),
);
