import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { assertAmountMatchesFlow } from "@/lib/stellar/assert-inbound-amount";
import { env, stellarPassphrase } from "@/lib/env";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { envelopeExpiresAt, resolveExecutablePipeline } from "@/lib/api/v1/execute";
import { ExecutePrepareSchema, type ExecutePrepared } from "@/lib/api/v1/schema";
import { clientIp } from "@/lib/rate-limit";
import { buildPipelineErrorHint } from "@/lib/stellar/pipeline-error-hint";
import { prepareFailure } from "@/lib/api/v1/prepare-error";
import { prepareTriggerTx } from "@/lib/stellar/trigger";

/**
 * Prepare the unsigned deposit that executes a deposit-triggered flow. The caller signs
 * it with the `from` key and posts it to `…/execute/submit`; no key is held here.
 */
export const POST = v1Route(
  { operation: "POST execute", rateLimit: V1_RATE_LIMITS.execute },
  async ({ req, params, token, tokenType, deployment }) => {
    const input = ExecutePrepareSchema.parse(
      await req.json().catch(() => {
        throw new AppError("VALIDATION", "Request body must be valid JSON");
      }),
    );
    const { nodes, triggerAddress } = resolveExecutablePipeline(deployment);

    assertAmountMatchesFlow(deployment.id, deployment.graphSnapshot, input.amount, {
      fixedSplitBatching: true,
    });

    const { xdr } = await prepareTriggerTx({
      contractAddress: triggerAddress,
      amount: input.amount,
      fromAddress: input.from,
      isPipeline: true,
      hint: () => buildPipelineErrorHint(nodes),
    }).catch((err: unknown) => {
      throw prepareFailure(err);
    });

    await audit({
      action: "API_EXECUTE_PREPARED",
      userId: deployment.ownerId,
      ip: clientIp(req),
      metadata: {
        deploymentId: params.id,
        tokenId: token.id,
        tokenType,
        from: input.from,
        amount: input.amount,
      },
    });

    const data: ExecutePrepared = {
      xdr,
      networkPassphrase: stellarPassphrase(),
      network: env().STELLAR_NETWORK,
      expiresAt: envelopeExpiresAt(xdr),
    };
    return NextResponse.json({ data });
  },
);
