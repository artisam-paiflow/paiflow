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
 * PDAX UAT supports XLM and USDCXLM for the Stellar network.
 */
export function offRampAssetCode(asset: Asset): string {
  if (asset.kind === "native") return "XLM";
  if (asset.kind === "known" && asset.symbol === "USDC") return "USDCXLM";
  // Custom / unknown assets fall back to the env default.
  return env().OFFRAMP_ASSET_CODE ?? "USDCXLM";
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
 * CASH_OUT_DEV contract address. Returns null if the deployment has no graph
 * snapshot or the node cannot be matched.
 */
export function resolveCashOutAsset(
  graph: FlowGraph | null,
  pipeline: PipelineNodeSnapshot[] | null,
  contractAddress: string,
): Asset | null {
  if (!graph || !pipeline) return null;
  const snapshot = pipeline.find(
    (p) => p.contractAddress === contractAddress && p.templateKind === "CASH_OUT_DEV",
  );
  if (!snapshot) return null;
  const node = graph.nodes.find(
    (n): n is Extract<FlowNode, { type: "cash_out" }> =>
      n.type === "cash_out" && n.id === snapshot.nodeId,
  );
  return node?.config.asset ?? null;
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
