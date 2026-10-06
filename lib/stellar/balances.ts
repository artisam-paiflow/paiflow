import "server-only";
import type { Deployment, TemplateKind } from "@prisma/client";
import type { Asset, FlowGraph } from "@/lib/flows/schema";
import { assetLabel, isContractAction } from "@/lib/flows/schema";
import { DEPLOYING_WALLET, resolveOwnerReturns } from "@/lib/flows/terminal-outcomes";
import { inFlowOrder } from "@/lib/flows/graph";
import { log } from "@/lib/log";
import { implementationLabel } from "@/lib/flows/implementation";
import { createTokenBalanceReader } from "./balance";
import { assetContractId } from "./assets";

export type BalanceNode = {
  implementationLabel?: string | null;
  nodeId: string;
  templateKind: TemplateKind;
  contractAddress: string;
  asset: Asset;
  symbol: string;
  balanceStroops: string;
};

export type BalanceNodeError = {
  implementationLabel?: string | null;
  nodeId: string;
  templateKind: TemplateKind;
  contractAddress: string;
  asset?: Asset;
  symbol?: string;
  error: string;
};

export type WorkflowBalances = {
  totals: Array<{ asset: Asset; symbol: string; balanceStroops: string }>;
  nodes: Array<BalanceNode | BalanceNodeError>;
  freshness?: BalanceFreshness;
};

export type BalanceTargetRead = {
  nodeId: string;
  contractAddress: string;
  asset?: Asset;
  symbol?: string;
  balanceStroops: string | null;
  readAt: string | null;
  stale: boolean;
  error?: string;
};

export type BalanceFreshness = {
  status: "fresh" | "partial" | "stale";
  totalsComplete: boolean;
  attemptedAt: string;
  cached: boolean;
  targets: BalanceTargetRead[];
};

export type ReadWorkflowBalances = WorkflowBalances & { freshness: BalanceFreshness };
export type BalanceDeployment = Pick<
  Deployment,
  "id" | "graphSnapshot" | "pipelineSnapshot" | "contractAddress" | "sourceAccount"
> & { flow: { templateKind: TemplateKind } };

type PipelineEntry = {
  implementation?: unknown;
  nodeId: string;
  contractAddress: string;
  templateKind: TemplateKind;
};

const BALANCE_HOLDING_KINDS = new Set<TemplateKind>([
  "STREAMER",
  "TIMELOCK",
  "TIMELOCK_BRANCH",
  "MULTISIG",
  "CONDITIONAL",
  "PAYER",
  "SWAPPER",
  "WEBHOOK",
  "SPLITTER",
]);

function isBalanceHolding(kind: TemplateKind): boolean {
  return BALANCE_HOLDING_KINDS.has(kind);
}

/**
 * The "flow asset" is the token that moves through the workflow.
 * Pipeline construction assigns this asset to triggers, conditions, and most
 * actions. For swapper flows the flow asset is assetIn.
 */
function getFlowAsset(graph: FlowGraph): Asset | null {
  const resolved = resolveOwnerReturns(graph, DEPLOYING_WALLET);
  const action = inFlowOrder(resolved, resolved.nodes.filter(isContractAction))[0];
  if (!action) return null;
  if (action.type === "swap") return action.config.assetIn;
  return action.config.asset;
}

function getSwapperAssetOut(graph: FlowGraph): Asset | null {
  const swap = graph.nodes.find((n) => n.type === "swap");
  if (!swap) return null;
  return swap.config.assetOut;
}

export async function getWorkflowBalances(
  deployment: BalanceDeployment,
): Promise<ReadWorkflowBalances> {
  const totalsMap = new Map<string, { asset: Asset; symbol: string; balance: bigint }>();
  const nodes: Array<BalanceNode | BalanceNodeError> = [];
  const freshness: BalanceFreshness = {
    status: "fresh",
    totalsComplete: true,
    attemptedAt: new Date().toISOString(),
    cached: false,
    targets: [],
  };

  const graph = deployment.graphSnapshot as FlowGraph | null;
  if (!graph) {
    freshness.status = "stale";
    freshness.totalsComplete = false;
    return { totals: [], nodes: [], freshness };
  }

  function unresolvedTarget(node: PipelineEntry) {
    const error = "Could not resolve the asset for this balance target";
    freshness.status = "partial";
    freshness.totalsComplete = false;
    nodes.push({
      nodeId: node.nodeId,
      contractAddress: node.contractAddress,
      templateKind: node.templateKind,
      implementationLabel: implementationLabel(node.implementation),
      error,
    });
    freshness.targets.push({
      nodeId: node.nodeId,
      contractAddress: node.contractAddress,
      balanceStroops: null,
      readAt: null,
      stale: true,
      error,
    });
  }

  const flowAsset = getFlowAsset(graph);
  const pipeline = (deployment.pipelineSnapshot as PipelineEntry[] | null) ?? [];
  const seenAddresses = new Set<string>();
  const targets: Array<{
    implementationLabel?: string | null;
    nodeId: string;
    templateKind: TemplateKind;
    contractAddress: string;
    asset: Asset;
  }> = [];

  for (const node of pipeline) {
    if (
      !node.contractAddress ||
      seenAddresses.has(node.contractAddress) ||
      !isBalanceHolding(node.templateKind)
    )
      continue;

    const asset = node.templateKind === "SWAPPER" ? getSwapperAssetOut(graph) : flowAsset;
    if (!asset) {
      unresolvedTarget(node);
      seenAddresses.add(node.contractAddress);
      log.warn(
        { deploymentId: deployment.id, nodeId: node.nodeId, templateKind: node.templateKind },
        "Could not resolve asset for balance-holding pipeline node",
      );
      continue;
    }

    targets.push({
      nodeId: node.nodeId,
      implementationLabel: implementationLabel(node.implementation),
      templateKind: node.templateKind,
      contractAddress: node.contractAddress,
      asset,
    });
    seenAddresses.add(node.contractAddress);
  }

  // Ensure the primary contract is included when it isn't part of the stored
  // pipeline snapshot (legacy standalone deployments) or was otherwise missed.
  if (
    deployment.contractAddress &&
    !seenAddresses.has(deployment.contractAddress) &&
    isBalanceHolding(deployment.flow.templateKind)
  ) {
    const asset =
      deployment.flow.templateKind === "SWAPPER" ? getSwapperAssetOut(graph) : flowAsset;
    if (asset) {
      targets.push({
        nodeId: "primary",
        templateKind: deployment.flow.templateKind,
        contractAddress: deployment.contractAddress,
        asset,
      });
    } else {
      unresolvedTarget({
        nodeId: "primary",
        contractAddress: deployment.contractAddress,
        templateKind: deployment.flow.templateKind,
      });
    }
  }

  const readBalance = targets.length ? createTokenBalanceReader(deployment.sourceAccount) : null;
  const results = await Promise.allSettled(
    targets.map(async (target) => {
      const tokenAddress = assetContractId(target.asset);
      const balance = await readBalance!({
        tokenAddress,
        holderAddress: target.contractAddress,
      });
      return { target, balance, readAt: new Date().toISOString() };
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const target = targets[i]!;
    const targetRead: BalanceTargetRead = {
      nodeId: target.nodeId,
      contractAddress: target.contractAddress,
      asset: target.asset,
      symbol: assetLabel(target.asset),
      balanceStroops: null,
      readAt: null,
      stale: true,
    };
    freshness.targets.push(targetRead);
    if (result.status === "rejected") {
      freshness.status = "partial";
      freshness.totalsComplete = false;
      targetRead.error =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      log.warn(
        { err: result.reason, deploymentId: deployment.id, nodeId: target.nodeId },
        "Failed to fetch balance for node",
      );
      nodes.push({
        nodeId: target.nodeId,
        implementationLabel: target.implementationLabel ?? null,
        templateKind: target.templateKind,
        contractAddress: target.contractAddress,
        asset: target.asset,
        symbol: assetLabel(target.asset),
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
      continue;
    }

    const { balance, readAt } = result.value;
    targetRead.balanceStroops = balance.toString();
    targetRead.readAt = readAt;
    targetRead.stale = false;
    if (balance <= 0n) continue;

    const symbol = assetLabel(target.asset);
    const balanceStroops = balance.toString();

    nodes.push({
      nodeId: target.nodeId,
      implementationLabel: target.implementationLabel ?? null,
      templateKind: target.templateKind,
      contractAddress: target.contractAddress,
      asset: target.asset,
      symbol,
      balanceStroops,
    });

    const key = assetContractId(target.asset);
    const existing = totalsMap.get(key);
    if (existing) {
      existing.balance += balance;
    } else {
      totalsMap.set(key, { asset: target.asset, symbol, balance });
    }
  }

  const totals = Array.from(totalsMap.values()).map((t) => ({
    asset: t.asset,
    symbol: t.symbol,
    balanceStroops: t.balance.toString(),
  }));

  if (freshness.targets.length && freshness.targets.every((target) => target.stale)) {
    freshness.status = "stale";
  }
  return { totals, nodes, freshness };
}
