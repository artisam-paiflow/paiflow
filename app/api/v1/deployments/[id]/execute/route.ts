import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { env, stellarPassphrase } from "@/lib/env";
import { v1Route } from "@/lib/api/v1/handler";
import { envelopeExpiresAt, resolveSwapperPipeline } from "@/lib/api/v1/execute";
import {
  EXECUTE_PREREQUISITES,
  ExecutePrepareSchema,
  type ExecutePrepared,
} from "@/lib/api/v1/schema";
import { clientIp } from "@/lib/rate-limit";
import { buildPipelineErrorHint } from "@/lib/stellar/pipeline-error-hint";
import { prepareTriggerTx } from "@/lib/stellar/trigger";

/**
 * Prepare the unsigned deposit that executes a swapper flow. The caller signs
 * it with the `from` key and posts it to `…/execute/submit`; no key is held here.
 */
export const POST = v1Route(
  { rateLimit: { limit: 30, windowSeconds: 60 } },
  async ({ req, params, token, deployment }) => {
    const input = ExecutePrepareSchema.parse(
      await req.json().catch(() => {
        throw new AppError("VALIDATION", "Request body must be valid JSON");
      }),
    );
    const { nodes, triggerAddress } = resolveSwapperPipeline(deployment);

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

function prepareFailure(err: unknown): AppError {
  if (err instanceof AppError) {
    // A simulation revert is about this deposit, not the RPC being down: an
    // unfunded `from`, a missing trustline, a pool with no liquidity.
    if (err.details?.startsWith("Soroban simulate failed")) {
      return new AppError(
        "VALIDATION",
        `${err.message} ${EXECUTE_PREREQUISITES}`,
        undefined,
        err.details,
      );
    }
    return err;
  }
  if (err instanceof Error && err.message.startsWith("Account not found")) {
    return new AppError(
      "INSUFFICIENT_FUNDS",
      `The \`from\` account does not exist on this network. ${EXECUTE_PREREQUISITES}`,
    );
  }
  return new AppError("UPSTREAM_RPC", "The Soroban RPC request failed; try again");
}
