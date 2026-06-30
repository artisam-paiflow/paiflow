import type { Asset } from "@/lib/flows/schema";
import type { FlowGraph, FlowNode } from "@/lib/flows/schema";
import { env } from "@/lib/env";

export type PipelineNodeSnapshot = {
  nodeId: string;
  contractAddress: string;
  templateKind: string;
};

/**
 * Map a Pinkraft asset to the PDAX Institution API quote currency.
 * Production PDAX wallets use USDC. The hackathon UAT environment also uses
 * USDC in the institutional wallet; Stellar USDC (USDCXLM) is disabled for UAT
 * deposits, so the PDAX balance must be pre-funded off-chain. Override per
 * environment with OFFRAMP_ASSET_CODE.
 */
export function offRampAssetCode(asset: Asset): string {
  if (asset.kind === "native") return "XLM";
  if (asset.kind === "known" && asset.symbol === "USDC") return "USDC";
  // Custom / unknown assets fall back to the env default.
  return env().OFFRAMP_ASSET_CODE ?? "USDC";
}

/**
 * PDAX network identifier. UAT uses the same value for all Stellar Testnet
 * assets supported in the hackathon environment.
 */
export function offRampNetwork(_asset: Asset): string {
  return env().OFFRAMP_NETWORK ?? "XLM_USDC_T_CEKS";
}

/** All supported Stellar assets use 7 decimal places. */
export function offRampAssetDecimals(_asset: Asset): number {
  return 7;
}

/**
 * Find the cash_out node in the saved graph that corresponds to the given
 * source address. The source address may be the cash_out contract itself, or it
 * may be an upstream contract (e.g. a deposit trigger) that forwards to the
 * cash_out node. We first try a direct match, then walk the graph edges from the
 * source node to find a connected cash_out node.
 */
export function resolveCashOutAsset(
  graph: FlowGraph | null,
  pipeline: PipelineNodeSnapshot[] | null,
  sourceAddress: string,
): Asset | null {
  if (!graph || !pipeline) return null;

  // Direct match: sourceAddress is the cash_out contract.
  const directSnapshot = pipeline.find(
    (p) =>
      p.contractAddress === sourceAddress &&
      (p.templateKind === "CASH_OUT_DEV" || p.templateKind === "CASH_OUT"),
  );
  if (directSnapshot) {
    const node = graph.nodes.find(
      (n): n is Extract<FlowNode, { type: "cash_out" }> =>
        n.type === "cash_out" && n.id === directSnapshot.nodeId,
    );
    if (node) return node.config.asset ?? null;
  }

  // Indirect match: sourceAddress is an upstream node (e.g. deposit trigger).
  // Find its graph node id via the pipeline, then follow outgoing edges to the
  // cash_out node.
  const sourceSnapshot = pipeline.find((p) => p.contractAddress === sourceAddress);
  if (!sourceSnapshot) return null;

  const targetIds = new Set(
    graph.edges.filter((edge) => edge.source === sourceSnapshot.nodeId).map((edge) => edge.target),
  );

  const cashOutNode = graph.nodes.find(
    (n): n is Extract<FlowNode, { type: "cash_out" }> =>
      n.type === "cash_out" && targetIds.has(n.id),
  );

  return cashOutNode?.config.asset ?? null;
}

/**
 * Resolve the asset for a payroll off-ramp job from the payroll trigger node's
 * config. This works for both the monolithic PAYROLL contract and the
 * decomposed dev-mode pipeline (SUBSCRIPTION_DEV → SPLITTER_DEV), because the
 * saved graph still contains the original `payroll` trigger with its asset.
 */
export function resolvePayrollAsset(graph: FlowGraph | null): Asset | null {
  if (!graph) return null;
  const trigger = graph.nodes.find(
    (n): n is Extract<FlowNode, { type: "payroll" }> => n.type === "payroll",
  );
  return trigger?.config.asset ?? null;
}
