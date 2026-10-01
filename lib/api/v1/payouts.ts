import "server-only";
import type { Deployment } from "@prisma/client";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { env, stellarPassphrase } from "@/lib/env";
import { checkPayoutTrustlines } from "@/lib/stellar/trustline-check";
import { updatePaymentByRelayer } from "@/lib/stellar/dev-mutate";
import { prepareTriggerTx } from "@/lib/stellar/trigger";
import { buildPipelineErrorHint } from "@/lib/stellar/pipeline-error-hint";
import { assertDepositEnvelope, envelopeExpiresAt } from "./execute";
import { payoutEligibility } from "./payout-eligibility";
import { prepareFailure } from "./prepare-error";
import { acquirePayoutLease } from "./payout-lease";
import type { PayoutPrepare, PayoutPrepared } from "./schema";

export async function preparePayout(
  deployment: Deployment,
  tokenId: string,
  input: PayoutPrepare,
  ip: string,
): Promise<PayoutPrepared> {
  const lease = await acquirePayoutLease(deployment.id, tokenId).catch((err: unknown) => {
    throw prepareFailure(err);
  });
  try {
    const eligible = await payoutEligibility(deployment, input);
    const checks = await checkPayoutTrustlines(
      [{ nodeId: eligible.selected.nodeId, address: input.recipient, asset: eligible.asset }],
      { fresh: true, requireAccount: true },
    );
    if (!checks.length || checks.some((c) => c.status !== "ok" && c.status !== "not_needed"))
      throw new AppError(
        "VALIDATION",
        "Recipient account/trustline readiness could not be established; no relayer mutation was sent",
      );
    await lease.assertOwnership();
    const unchanged =
      eligible.current.recipient === input.recipient &&
      eligible.current.amountStroops === eligible.required.amountStroops &&
      eligible.current.percentageBps === eligible.required.percentageBps;
    if (!unchanged) {
      const result = await updatePaymentByRelayer(
        eligible.selected.contractAddress,
        { recipient: input.recipient, ...eligible.required, isCashOut: false },
        {
          beforeSubmit: async (tx) => {
            const maxTime = tx.timeBounds?.maxTime;
            if (!maxTime || BigInt(maxTime) <= 0n)
              throw new AppError(
                "INTERNAL",
                "Configuration transaction must have a finite validity window",
              );
            await lease.checkpointConfiguration({ txHash: tx.hash().toString("hex"), maxTime });
            await audit({
              action: "API_PAYOUT_CONFIGURED",
              userId: deployment.ownerId,
              ip,
              metadata: {
                deploymentId: deployment.id,
                tokenId,
                nodeId: eligible.selected.nodeId,
                txHash: tx.hash().toString("hex"),
                status: "PREPARED",
              },
            });
          },
        },
      );
      await audit({
        action: "API_PAYOUT_CONFIGURED",
        userId: deployment.ownerId,
        ip,
        metadata: {
          deploymentId: deployment.id,
          tokenId,
          nodeId: eligible.selected.nodeId,
          txHash: result.txHash,
          status: result.status,
        },
      });
      if (result.status !== "SUCCESS")
        throw new AppError(
          "UPSTREAM_RPC",
          "Payment configuration has not confirmed; protection is retained until its outcome is established",
        );
      await lease.configurationFinal();
    }
    await lease.assertOwnership();
    const { xdr } = await prepareTriggerTx({
      contractAddress: eligible.triggerAddress,
      amount: input.amount,
      fromAddress: input.from,
      isPipeline: true,
      hint: () => buildPipelineErrorHint(eligible.nodes),
    });
    const tx = assertDepositEnvelope(xdr, eligible.triggerAddress);
    const maxTime = tx.timeBounds?.maxTime;
    if (!maxTime || BigInt(maxTime) <= 0n)
      throw new AppError("INTERNAL", "Prepared payout needs a finite validity window");
    await lease.ready({ txHash: tx.hash().toString("hex"), maxTime });
    await audit({
      action: "API_PAYOUT_PREPARED",
      userId: deployment.ownerId,
      ip,
      metadata: {
        deploymentId: deployment.id,
        tokenId,
        nodeId: eligible.selected.nodeId,
        from: input.from,
        recipient: input.recipient,
        amount: input.amount,
        txHash: tx.hash().toString("hex"),
      },
    });
    await lease.assertReadyOwnership();
    return {
      xdr,
      nodeId: eligible.selected.nodeId,
      networkPassphrase: stellarPassphrase(),
      network: env().STELLAR_NETWORK,
      expiresAt: envelopeExpiresAt(xdr),
    };
  } catch (err) {
    throw prepareFailure(err);
  } finally {
    await lease.close();
  }
}
