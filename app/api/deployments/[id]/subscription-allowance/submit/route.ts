import { NextRequest, NextResponse } from "next/server";
import { deploymentServiceRoute } from "@/lib/deployments/service-route";
import { AppError, withErrorHandler } from "@/lib/errors";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { audit, needsSubmitRow } from "@/lib/audit";
import { recordSignedTransaction } from "@/lib/signed-tx";
import {
  withInteractiveRpcBudget,
  interactiveRpcBudgetExpired,
} from "@/lib/stellar/interactive-rpc-budget";
import { sorobanRpc } from "@/lib/stellar/client";
import { submitTriggerTx } from "@/lib/stellar/trigger";
import { subscriptionState, requireSubscriber } from "@/lib/subscription/state";
import { AllowanceDeploymentIdSchema, AllowanceSubmitSchema } from "@/lib/subscription/schema";
import { verifyAllowanceIntent } from "@/lib/subscription/intent";

async function POSTHandler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const id = AllowanceDeploymentIdSchema.parse((await ctx.params).id);
    const ip = clientIp(req);
    await enforceRateLimit({
      key: `subscription-allowance-submit:${ip}`,
      limit: 20,
      windowSeconds: 60,
    });
    const body = AllowanceSubmitSchema.parse(await req.json());
    const { intent, signer } = verifyAllowanceIntent(body.intent, body.signedXdr, id);
    // Eligibility and original-hash lookup share one deadline. Durable bookkeeping
    // and sending below finish independently; uncertainty never permits replacement.
    const { state, known } = await withInteractiveRpcBudget(async () => {
      const state = await subscriptionState(id, { classifyRpcFailures: true });
      if (
        state.contractAddress !== intent.contractAddress ||
        state.tokenContractAddress !== intent.tokenContractAddress
      )
        throw new AppError(
          "VALIDATION",
          "Subscription configuration changed; check transaction status before preparing again",
        );

      // A replay or a lost submit response must never create a second approval.
      // Check the exact prepared hash before considering another send. Current
      // subscriber changes do not erase a previously confirmed wallet consent.
      const known = await sorobanRpc()
        .getTransaction(intent.txHash)
        .catch(() => {
          throw new AppError(
            "UPSTREAM_RPC",
            "Cannot determine approval status; check the prepared transaction hash before trying again",
          );
        });
      if (!["NOT_FOUND", "SUCCESS", "FAILED"].includes(known.status))
        throw new AppError(
          "UPSTREAM_RPC",
          "Cannot establish approval status; submission was not attempted",
        );
      if (known.status === "NOT_FOUND") requireSubscriber(state, intent.subscriber);
      if (interactiveRpcBudgetExpired())
        throw new AppError(
          "UPSTREAM_RPC",
          "Approval eligibility exceeded its RPC deadline; check the original transaction hash",
        );
      return { state, known };
    });
    if (known.status === "FAILED")
      return NextResponse.json({
        data: {
          txHash: intent.txHash,
          status: "FAILED",
          errorMessage: "Transaction failed on the network",
        },
      });
    const sessionUser = await getSessionUser();
    await recordSignedTransaction({
      signer,
      kind: "INVOKE",
      network: state.network,
      userId: sessionUser?.id ?? null,
      deploymentId: id,
      ip,
    });
    // Write before sending so an uncertain RPC result can still be reconciled
    // by the public tx-status route. It records intent to submit, not success.
    if (await needsSubmitRow(id, intent.txHash, true))
      await audit({
        action: "DEPLOY_INVOKE",
        userId: sessionUser?.id ?? null,
        ip,
        metadata: {
          deploymentId: id,
          txHash: intent.txHash,
          signerAddress: intent.subscriber,
          method: "approve",
        },
      });
    if (known.status === "SUCCESS")
      return NextResponse.json({ data: { txHash: intent.txHash, status: "SUCCESS" } });
    const result = await submitTriggerTx(body.signedXdr).catch(() => {
      throw new AppError(
        "UPSTREAM_RPC",
        "Approval submission outcome is unknown; check the prepared transaction hash before trying again",
      );
    });
    if (result.status === "FAILED")
      throw new AppError("UPSTREAM_RPC", "Allowance transaction was rejected by the network");
    return NextResponse.json({ data: { txHash: intent.txHash, status: "PENDING" } });
  });
}

export const POST = deploymentServiceRoute(POSTHandler, "public");
