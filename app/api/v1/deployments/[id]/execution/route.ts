import { NextResponse } from "next/server";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { readExecutionState } from "@/lib/stellar/execution-state";
import { withInteractiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";

export const GET = v1Route(
  { operation: "GET execution", rateLimit: V1_RATE_LIMITS.capabilities },
  async ({ deployment }) =>
    withInteractiveRpcBudget(async () =>
      NextResponse.json({ data: await readExecutionState(deployment) }),
    ),
);
