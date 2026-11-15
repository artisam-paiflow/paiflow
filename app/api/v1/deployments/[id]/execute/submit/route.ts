import { NextResponse } from "next/server";
import { withInteractiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";
import { linkApiTransaction } from "@/lib/api/request-history/context";
import { AppError } from "@/lib/errors";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { assertDepositEnvelope, resolveExecutablePipeline } from "@/lib/api/v1/execute";
import { ExecuteSubmitQuerySchema, ExecuteSubmitSchema } from "@/lib/api/v1/schema";
import { clientIp } from "@/lib/rate-limit";
import { submitPreparedDeposit } from "@/lib/stellar/submit-deposit";
import { submitExecutionPayment } from "@/lib/api/v1/execution-payments";
import { hasExecutionPolicies } from "@/lib/api/v1/execution-schema";
import { hasConditionalDeploymentDeclaration } from "@/lib/flows/conditional-deployment";
import { conditionalExecutionVersion } from "@/lib/api/v1/conditional-execution-schema";
import { submitConditionalExecutionPayment } from "@/lib/api/v1/conditional-execution-payments";

export const POST = v1Route(
  { operation: "POST execute/submit", rateLimit: V1_RATE_LIMITS.executeSubmit },
  async ({ req, params, token, tokenType, deployment }) =>
    withInteractiveRpcBudget(async () => {
      const version = conditionalExecutionVersion(new URL(req.url).searchParams);
      const input = ExecuteSubmitSchema.parse(
        await req.json().catch(() => {
          throw new AppError("VALIDATION", "Request body must be valid JSON");
        }),
      );
      const { wait } = ExecuteSubmitQuerySchema.parse({
        wait: new URL(req.url).searchParams.get("wait") ?? undefined,
      });
      if (version === 2) {
        const data = await submitConditionalExecutionPayment({
          deployment,
          tokenId: token.id,
          tokenType,
          signedXdr: input.signedXdr,
          intent: input.intent,
          wait,
          ip: clientIp(req),
        });
        return NextResponse.json({ data });
      }
      if (hasConditionalDeploymentDeclaration(deployment.paramsSnapshot))
        throw new AppError("VALIDATION", "Conditional execution requires explicit version2 opt-in");
      const { nodes, triggerAddress } = resolveExecutablePipeline(deployment);
      if (hasExecutionPolicies(deployment.graphSnapshot)) {
        const data = await submitExecutionPayment({
          deployment,
          tokenId: token.id,
          tokenType,
          signedXdr: input.signedXdr,
          intent: input.intent,
          wait,
          ip: clientIp(req),
        });
        return NextResponse.json({ data });
      }
      if (input.intent !== undefined)
        throw new AppError(
          "VALIDATION",
          "Legacy deployments have no execution preparation identifier",
        );
      const tx = assertDepositEnvelope(input.signedXdr, triggerAddress);
      linkApiTransaction(tx.hash().toString("hex"));
      const data = await submitPreparedDeposit({
        tx,
        wait,
        tokenId: token.id,
        tokenType,
        deploymentId: params.id,
        deployment,
        nodes,
        ip: clientIp(req),
      });
      return NextResponse.json({ data });
    }),
);
