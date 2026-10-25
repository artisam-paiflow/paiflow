import "server-only";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { FlowGraphSchema, isTrigger, assetLabel } from "@/lib/flows/schema";
import { findPipelineNode, pipelineNodesOfKind } from "@/lib/pipeline-snapshot";
import { withInteractiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";
import { assetContractId } from "@/lib/stellar/assets";
import {
  readSubscriptionAsset,
  readSubscriptionSubscriberNullable,
  readSubscriptionIsCancelled,
  readTokenAllowance,
} from "@/lib/stellar/relayer";

export async function readSubscriptionState(
  id: string,
  opts: { snapshotOnly?: boolean; classifyRpcFailures?: boolean } = {},
) {
  const d = await db.deployment.findFirst({
    where: { id, status: "CONFIRMED" },
    select: {
      id: true,
      network: true,
      pipelineSnapshot: true,
      graphSnapshot: true,
      flow: { select: { name: true, templateKind: true } },
    },
  });
  if (!d) throw new AppError("NOT_FOUND", "Deployment not found or not confirmed");
  if (d.network !== env().STELLAR_NETWORK)
    throw new AppError("VALIDATION", "Deployment network does not match this environment");
  const graph = FlowGraphSchema.safeParse(d.graphSnapshot);
  const trigger = graph.success ? graph.data.nodes.find(isTrigger) : null;
  if (
    (!opts.snapshotOnly && d.flow.templateKind !== "SUBSCRIPTION") ||
    trigger?.type !== "subscription"
  ) {
    throw new AppError("VALIDATION", "Deployment is not a subscription");
  }
  if (
    opts.snapshotOnly &&
    (!graph.success ||
      graph.data.nodes.filter(isTrigger).length !== 1 ||
      !Array.isArray(d.pipelineSnapshot) ||
      (d.pipelineSnapshot[0] as { nodeId?: string } | undefined)?.nodeId !== trigger.id)
  )
    throw new AppError("VALIDATION", "Malformed subscription deployment snapshot");
  const nodes = [
    ...pipelineNodesOfKind(d.pipelineSnapshot, "SUBSCRIPTION"),
    ...pipelineNodesOfKind(d.pipelineSnapshot, "SUBSCRIPTION_DEV"),
  ];
  if (nodes.length !== 1 || nodes[0]!.nodeId !== trigger.id)
    throw new AppError("VALIDATION", "Subscription contract address not available or ambiguous");
  const node = findPipelineNode(
    d.pipelineSnapshot,
    nodes[0]!.templateKind as "SUBSCRIPTION" | "SUBSCRIPTION_DEV",
    trigger.id,
  );
  if (!StrKey.isValidContract(node.contractAddress))
    throw new AppError("VALIDATION", "Invalid subscription contract address");
  const [subscriber, tokenContractAddress, isCancelled] = await Promise.all([
    readSubscriptionSubscriberNullable(node.contractAddress, opts),
    readSubscriptionAsset(node.contractAddress, opts),
    readSubscriptionIsCancelled(node.contractAddress, opts),
  ]);
  if (
    (subscriber !== null && !StrKey.isValidEd25519PublicKey(subscriber)) ||
    !StrKey.isValidContract(tokenContractAddress)
  ) {
    throw new AppError(
      "UPSTREAM_RPC",
      "Invalid subscription configuration returned by the contract",
    );
  }
  const asset =
    assetContractId(trigger.config.asset) === tokenContractAddress ? trigger.config.asset : null;
  return {
    deploymentId: d.id,
    flowName: d.flow.name,
    network: d.network as "testnet" | "mainnet",
    contractAddress: node.contractAddress,
    tokenContractAddress,
    subscriber,
    isCancelled,
    asset,
    assetLabel: asset ? assetLabel(asset) : tokenContractAddress,
    templateKind: node.templateKind as "SUBSCRIPTION" | "SUBSCRIPTION_DEV",
  };
}

/** Preserve public response shape and eligibility; interactive routes opt into safe reads. */
export async function subscriptionState(id: string, opts: { classifyRpcFailures?: boolean } = {}) {
  const { templateKind: _templateKind, ...state } = await readSubscriptionState(id, opts);
  return state;
}

export function requireSubscriber(
  state: Awaited<ReturnType<typeof subscriptionState>>,
  address?: string,
) {
  if (!state.subscriber)
    throw new AppError(
      "VALIDATION",
      "The team must configure the Dev subscriber before allowance approval",
    );
  if (address && state.subscriber !== address)
    throw new AppError("FORBIDDEN", "Connected wallet does not match the configured subscriber");
  if (state.isCancelled)
    throw new AppError(
      "VALIDATION",
      "Subscription is cancelled; the team must reactivate it before approval",
    );
  return state.subscriber;
}

/** Interactive deployment-token read; public/background helpers keep their defaults. */
export async function subscriptionAllowanceState(id: string) {
  return withInteractiveRpcBudget(async () => {
    const state = await readSubscriptionState(id, {
      snapshotOnly: true,
      classifyRpcFailures: true,
    });
    if (!state.subscriber && state.templateKind !== "SUBSCRIPTION_DEV")
      throw new AppError("UPSTREAM_RPC", "Ordinary subscription has no configured subscriber");
    const allowance = state.subscriber
      ? await readTokenAllowance({
          tokenContractAddress: state.tokenContractAddress,
          owner: state.subscriber,
          spender: state.contractAddress,
          classifyRpcFailures: true,
        })
      : null;
    if (allowance !== null && (allowance < 0n || allowance > (1n << 127n) - 1n))
      throw new AppError("UPSTREAM_RPC", "Invalid allowance returned by the contract");
    return { ...state, allowance: allowance?.toString() ?? "0", setupRequired: !state.subscriber };
  });
}
