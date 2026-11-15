import { NextResponse } from "next/server";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { readExecutionState } from "@/lib/stellar/execution-state";
import { withInteractiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";
import { readConditionalExecutionState } from "@/lib/stellar/conditional-execution-state";
import { hasConditionalDeploymentDeclaration } from "@/lib/flows/conditional-deployment";
import { conditionalExecutionVersion } from "@/lib/api/v1/conditional-execution-schema";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

export const GET = v1Route(
  { operation: "GET execution", rateLimit: V1_RATE_LIMITS.capabilities },
  async ({ deployment, req }) =>
    withInteractiveRpcBudget(async () => {
      const version = conditionalExecutionVersion(new URL(req.url).searchParams);
      if (version === 2)
        return NextResponse.json({ data: await readConditionalExecutionState(deployment) });
      if (hasConditionalDeploymentDeclaration(deployment.paramsSnapshot)) {
        if (deployment.status !== "CONFIRMED" || deployment.network !== env().STELLAR_NETWORK)
          throw new AppError("NOT_FOUND", "Deployment unavailable on this network");
        return NextResponse.json({
          data: {
            supported: false,
            deploymentId: deployment.id,
            network: deployment.network,
            policyVersion: 0,
            reason: "Conditional execution requires explicit version2 opt-in",
          },
        });
      }
      return NextResponse.json({ data: await readExecutionState(deployment) });
    }),
);
