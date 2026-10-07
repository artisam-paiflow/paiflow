import { NextResponse } from "next/server";
import { z } from "zod";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { getTransactionStatus } from "@/lib/api/v1/transaction-status";

export const GET = v1Route<{ id: string; txHash: string }>(
  {
    rateLimit: V1_RATE_LIMITS.transactions,
    rateLimitRoute: "/api/v1/deployments/:id/transactions/:txHash",
  },
  async ({ params, deployment }) => {
    const txHash = z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/)
      .parse(params.txHash)
      .toLowerCase();
    return NextResponse.json(
      { data: await getTransactionStatus(deployment, txHash) },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  },
);
