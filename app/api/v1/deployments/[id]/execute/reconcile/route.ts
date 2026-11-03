import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { reconcileControlIntent } from "@/lib/api/v1/control-intent";
import { ExecutionReconcileSchema } from "@/lib/api/v1/execution-schema";
import { getTransactionStatus } from "@/lib/api/v1/transaction-status";
import { withInteractiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";

export const POST = v1Route(
  { operation: "POST execute/reconcile", rateLimit: V1_RATE_LIMITS.executeSubmit },
  async ({ deployment, req }) =>
    withInteractiveRpcBudget(async () => {
      const input = ExecutionReconcileSchema.parse(
        await req.json().catch(() => {
          throw new AppError("VALIDATION", "Request body must be valid JSON");
        }),
      );
      const intent = await reconcileControlIntent(input.intent, deployment.id, "payment.execute");
      return NextResponse.json({
        data: {
          intent: intent.id,
          state: intent.state,
          transaction: await getTransactionStatus(deployment, intent.txHash),
        },
      });
    }),
);
