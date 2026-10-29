import "server-only";
import type { ApiTokenType } from "@/lib/api/v1/auth";
import type { Deployment } from "@prisma/client";
import { log } from "@/lib/log";
import { AppError } from "@/lib/errors";
import { stellarPassphrase } from "@/lib/env";
import { clientIp } from "@/lib/rate-limit";
import { readSubscriptionState } from "@/lib/subscription/state";
import { pipelineNodesOfKind } from "@/lib/pipeline-snapshot";
import { sorobanRpc } from "@/lib/stellar/client";
import {
  interactiveRpcBudgetExpired,
  withInteractiveRpcBudget,
} from "@/lib/stellar/interactive-rpc-budget";
import {
  prepareSubscriptionSubscribeInvocation,
  prepareSubscriptionUnsubscribeInvocation,
} from "@/lib/stellar/invoke";
import { linkApiTransaction } from "@/lib/api/request-history/context";
import { deploymentCapabilities } from "./capabilities";
import {
  createControlIntent,
  readControlIntent,
  reconcileControlIntent,
  type WalletControlAction,
} from "./control-intent";
import { submitControlIntent } from "./control-submission";

export type SubscriptionControlAction = Extract<
  WalletControlAction,
  "subscription.cancel" | "subscription.reactivate"
>;

function assertSupported(deployment: Deployment, action: SubscriptionControlAction) {
  const operation =
    action === "subscription.cancel" ? "subscriptionCancel" : "subscriptionReactivate";
  if (deploymentCapabilities(deployment).operations[operation].status === "unsupported")
    throw new AppError(
      "VALIDATION",
      "Subscription control is unsupported on this deployment or server",
    );
}

async function eligible(
  deployment: Deployment,
  action: SubscriptionControlAction,
  walletAddress: string,
  classifyRpcFailures = false,
) {
  assertSupported(deployment, action);
  const state = await readSubscriptionState(deployment.id, {
    snapshotOnly: true,
    classifyRpcFailures,
  });
  if (!state.subscriber)
    throw new AppError("VALIDATION", "Configure the subscriber before using wallet controls");
  if (state.subscriber !== walletAddress)
    throw new AppError("FORBIDDEN", "Wallet does not match the current configured subscriber");
  if (state.isCancelled !== (action === "subscription.reactivate"))
    throw new AppError(
      "CONFLICT",
      action === "subscription.cancel"
        ? "Subscription is already cancelled"
        : "Subscription is already active",
    );
  const nodes = pipelineNodesOfKind(deployment.pipelineSnapshot, state.templateKind);
  if (nodes.length !== 1 || nodes[0]!.contractAddress !== state.contractAddress)
    throw new AppError(
      "VALIDATION",
      "Subscription snapshot no longer matches the selected contract",
    );
  return { state, node: nodes[0]! };
}

export async function prepareSubscriptionControl(
  deployment: Deployment,
  action: SubscriptionControlAction,
  walletAddress: string,
) {
  return withInteractiveRpcBudget(async () => {
    const { state, node } = await eligible(deployment, action, walletAddress, true);
    // Cover the full simulation/signing window when proving an abandoned intent expired.
    let preparationLedger: number;
    try {
      preparationLedger = (await sorobanRpc().getLatestLedger()).sequence;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "UPSTREAM_RPC",
        "Cannot establish the control preparation ledger; try again",
      );
    }
    const builder =
      action === "subscription.cancel"
        ? prepareSubscriptionUnsubscribeInvocation
        : prepareSubscriptionSubscribeInvocation;
    const { xdr } = await builder({
      contractAddress: node.contractAddress,
      subscriberAddress: walletAddress,
    });
    const afterSimulation = await eligible(deployment, action, walletAddress, true);
    if (
      afterSimulation.state.tokenContractAddress !== state.tokenContractAddress ||
      afterSimulation.node.nodeId !== node.nodeId ||
      afterSimulation.node.contractAddress !== node.contractAddress
    )
      throw new AppError("CONFLICT", "Subscription configuration changed during preparation");
    // Expired RPC work must not reserve a new intent. Once durable bookkeeping
    // starts, let it finish rather than racing it against the RPC deadline.
    if (interactiveRpcBudgetExpired())
      throw new AppError(
        "UPSTREAM_RPC",
        "Subscription control preparation exceeded its RPC deadline; try preparing again",
      );
    const preparation = await createControlIntent({
      deployment,
      nodeId: node.nodeId,
      action,
      walletAddress,
      unsignedXdr: xdr,
      preparationLedger,
    });
    linkApiTransaction(preparation.txHash);
    return {
      ...preparation,
      xdr,
      network: state.network,
      networkPassphrase: stellarPassphrase(),
      action,
      walletAddress,
      nodeId: node.nodeId,
      contractAddress: node.contractAddress,
      tokenContractAddress: state.tokenContractAddress,
    };
  });
}

export async function submitSubscriptionControl(input: {
  deployment: Deployment;
  action: SubscriptionControlAction;
  intent: string;
  signedXdr: string;
  tokenId: string;
  tokenType?: ApiTokenType;
  req: Parameters<typeof clientIp>[0];
}) {
  // A valid signed retry uses durable finality even after cancellation/configuration changed.
  const intent = await readControlIntent(input.intent, input.deployment.id, input.action);
  return submitControlIntent({
    ...input,
    ip: clientIp(input.req),
    // Only pre-send reads own this deadline. Close the budget before durable
    // claiming/sending; an accepted transaction must keep its original finality.
    assertEligible: () =>
      withInteractiveRpcBudget(async () => {
        const { node } = await eligible(input.deployment, input.action, intent.walletAddress, true);
        if (node.nodeId !== intent.nodeId || node.contractAddress !== intent.contractAddress)
          throw new AppError("VALIDATION", "Subscription control target changed since preparation");
        if (interactiveRpcBudgetExpired())
          throw new AppError(
            "UPSTREAM_RPC",
            "Subscription eligibility exceeded its RPC deadline; retry the original intent",
          );
      }),
  });
}

/** Interactive recovery has one budget; background retirement retains its defaults. */
export function reconcileSubscriptionControl(
  id: string,
  deploymentId: string,
  action: SubscriptionControlAction,
) {
  const startedAt = Date.now();
  return withInteractiveRpcBudget(async () => {
    try {
      return await reconcileControlIntent(id, deploymentId, action);
    } catch (error) {
      if (error instanceof AppError && error.code === "UPSTREAM_RPC")
        log.warn(
          {
            operation: "subscription.reconcile",
            deploymentId,
            category: interactiveRpcBudgetExpired() ? "deadline" : "upstream",
            elapsedMs: Math.max(0, Date.now() - startedAt),
          },
          "Subscription finality unavailable; reservation retained",
        );
      throw error;
    }
  });
}
