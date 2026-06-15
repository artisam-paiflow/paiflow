import "server-only";
import type { Deployment, TemplateKind } from "@prisma/client";
import { fetchTokenBalance } from "./balance";
import { assetContractId } from "./assets";
import type { Asset, FlowGraph } from "@/lib/flows/schema";
import { assetLabel, isContractAction } from "@/lib/flows/schema";
import { log } from "@/lib/log";

export type BalanceNode = {
  nodeId: string;
  templateKind: TemplateKind;
  contractAddress: string;
  asset: Asset;
  symbol: string;
  balanceStroops: string;
};

export type BalanceNodeError = {
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
};

type PipelineEntry = {
  nodeId: string;
  contractAddress: string;
  templateKind: TemplateKind;
};

const BALANCE_HOLDING_KINDS = new Set<TemplateKind>([
  "STREAMER",
  "TIMELOCK",
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
  const action = graph.nodes.find(isContractAction);
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
  deployment: Deployment & { flow: { templateKind: TemplateKind } },
): Promise<WorkflowBalances> {
  const totalsMap = new Map<string, { asset: Asset; symbol: string; balance: bigint }>();
  const nodes: Array<BalanceNode | BalanceNodeError> = [];

  const graph = deployment.graphSnapshot as FlowGraph | null;
  if (!graph) {
    return { totals: [], nodes: [] };
  }

  const flowAsset = getFlowAsset(graph);
  const pipeline = (deployment.pipelineSnapshot as PipelineEntry[] | null) ?? [];
  const seenAddresses = new Set<string>();
  const targets: Array<{
    nodeId: string;
    templateKind: TemplateKind;
    contractAddress: string;
    asset: Asset;
  }> = [];

  for (const node of pipeline) {
    if (!node.contractAddress || !isBalanceHolding(node.templateKind)) continue;

    const asset = node.templateKind === "SWAPPER" ? getSwapperAssetOut(graph) : flowAsset;
    if (!asset) {
      log.warn(
        { deploymentId: deployment.id, nodeId: node.nodeId, templateKind: node.templateKind },
        "Could not resolve asset for balance-holding pipeline node",
      );
      continue;
    }

    targets.push({
      nodeId: node.nodeId,
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
    }
  }

  const results = await Promise.allSettled(
    targets.map(async (target) => {
      const tokenAddress = assetContractId(target.asset);
      const balance = await fetchTokenBalance({
        tokenAddress,
        holderAddress: target.contractAddress,
        sourceAccount: deployment.sourceAccount,
      });
      return { target, balance };
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const target = targets[i]!;
    if (result.status === "rejected") {
      log.warn(
        { err: result.reason, deploymentId: deployment.id, nodeId: target.nodeId },
        "Failed to fetch balance for node",
      );
      nodes.push({
        nodeId: target.nodeId,
        templateKind: target.templateKind,
        contractAddress: target.contractAddress,
        asset: target.asset,
        symbol: assetLabel(target.asset),
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
      continue;
    }

    const { balance } = result.value;
    if (balance <= 0n) continue;

    const symbol = assetLabel(target.asset);
    const balanceStroops = balance.toString();

    nodes.push({
      nodeId: target.nodeId,
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

  return { totals, nodes };
}
