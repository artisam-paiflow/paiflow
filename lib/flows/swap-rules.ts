import { ASSET_CATALOGUE, assetOptionValue, isCatalogueAsset } from "./asset-catalogue";
import type { ValidationIssue } from "./issue";
import { assetLabel, MIN_SWAP_SLIPPAGE_BPS, type Asset, type FlowNode } from "./schema";

// Pure and client-safe: the builder panel, validateFlow and the tests read the
// same rules. Deliberately not a .superRefine on SwapAction — autosave parses
// the shape schema, and a same-asset swap mid-edit must still save.

export type SwapNode = Extract<FlowNode, { type: "swap" }>;

export type SwapRuleContext = {
  /** On-chain next steps: outgoing edges, not counting email_notify targets. */
  nextStepCount: number;
  /** The asset `computeAssetFlow` resolves into this swap, or null if unconstrained. */
  incomingAsset: Asset | null;
  /** The trigger's asset, so an unsupported asset arriving from it can be named. */
  triggerAsset: Asset | null;
};

const SUPPORTED = ASSET_CATALOGUE.map((e) => assetLabel(e.asset)).join(" or ");

const FRIENDLY = {
  SWAP_SINGLE_EDGE:
    "A swap sends its whole output to one next step. Remove the extra connections coming out of it, or add a Split block after the swap.",
  SWAP_NEEDS_NEXT_STEP:
    "A swap sends its whole output to one next step, so it needs one. Connect it to a Pay or Split block — an email notification doesn't count as a destination.",
  SWAP_SLIPPAGE_TOO_LOW:
    "Soroswap's pool fee is 0.3%, so a max slippage under 0.3% makes every swap revert. Set it to at least 0.3%.",
  SWAP_SAME_ASSET: (asset: string) =>
    `A swap has to exchange two different assets, and both sides of this one are ${asset}. Change "Asset Out" to the asset you want back, or remove the swap.`,
  SWAP_ASSET_NOT_SUPPORTED: (asset: string, side: "Asset In" | "Asset Out") =>
    `Swaps support ${SUPPORTED} only, and "${side}" is set to ${asset}. Pick ${SUPPORTED} instead.`,
  SWAP_ASSET_FROM_TRIGGER: (asset: string) =>
    `This swap receives ${asset} from the trigger, and swaps support ${SUPPORTED} only. Change the trigger's asset to ${SUPPORTED}, then set "Asset In" to match.`,
};

function sameAsset(a: Asset, b: Asset): boolean {
  return assetOptionValue(a) === assetOptionValue(b);
}

export function swapConfigIssues(node: SwapNode, ctx: SwapRuleContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { assetIn, assetOut, slippageBps } = node.config;
  const at = (field: string) => `nodes.${node.id}.config.${field}`;

  // Only XLM/USDC is verified on the pinned router, and the pair's SAC
  // addresses are fixed in an immutable constructor. A custom asset (including
  // a PENDING: issuer, which `new Asset()` would throw on as a 500) stops here.
  if (!isCatalogueAsset(assetIn)) {
    const fromTrigger =
      ctx.incomingAsset !== null &&
      ctx.triggerAsset !== null &&
      sameAsset(ctx.incomingAsset, assetIn) &&
      sameAsset(ctx.triggerAsset, assetIn);
    issues.push({
      path: at("assetIn"),
      message: `Swap asset ${assetLabel(assetIn)} is not supported`,
      friendlyMessage: fromTrigger
        ? FRIENDLY.SWAP_ASSET_FROM_TRIGGER(assetLabel(assetIn))
        : FRIENDLY.SWAP_ASSET_NOT_SUPPORTED(assetLabel(assetIn), "Asset In"),
      code: "SWAP_ASSET_NOT_SUPPORTED",
      nodeId: node.id,
      field: "assetIn",
    });
  }
  if (!isCatalogueAsset(assetOut)) {
    issues.push({
      path: at("assetOut"),
      message: `Swap asset ${assetLabel(assetOut)} is not supported`,
      friendlyMessage: FRIENDLY.SWAP_ASSET_NOT_SUPPORTED(assetLabel(assetOut), "Asset Out"),
      code: "SWAP_ASSET_NOT_SUPPORTED",
      nodeId: node.id,
      field: "assetOut",
    });
  }

  // Both sides the same asset is not a trade: Soroswap has no pair for it,
  // so `factory.get_pair` panics on the first trigger and the flow reverts
  // after the user has already paid to deploy it. Nothing downstream
  // catches this — the constructor stores the pair without checking it, and
  // computeAssetFlow propagates assetOut, so the rest of the graph agrees.
  if (sameAsset(assetIn, assetOut)) {
    issues.push({
      path: at("assetOut"),
      message: "Swap node must exchange two different assets",
      friendlyMessage: FRIENDLY.SWAP_SAME_ASSET(assetLabel(assetOut)),
      code: "SWAP_SAME_ASSET",
      nodeId: node.id,
      field: "assetOut",
    });
  }

  // The contract's amount_out_min is spot less slippageBps, while the router
  // has already taken its 0.3% fee off the output, so a bound under the fee
  // fails the router's check on every trigger (see the swapper crate's
  // `zero_slippage_reverts_on_the_pool_fee_alone`). Schema keeps min(0) so
  // graphs saved before this rule still load; only deploying is refused.
  if (slippageBps < MIN_SWAP_SLIPPAGE_BPS) {
    issues.push({
      path: at("slippageBps"),
      message: `Swap slippage must be at least ${MIN_SWAP_SLIPPAGE_BPS} bps`,
      friendlyMessage: FRIENDLY.SWAP_SLIPPAGE_TOO_LOW,
      code: "SWAP_SLIPPAGE_TOO_LOW",
      nodeId: node.id,
      field: "slippageBps",
    });
  }

  // A swap forwards its entire output to next_steps[0]; the contract rejects
  // both zero and more than one next step at construction. Zero matters as
  // much as two: do_swap still executes the trade and then leaves asset_out in
  // the swapper, which has no withdrawal path, so the output is unrecoverable.
  if (ctx.nextStepCount === 0) {
    issues.push({
      path: `nodes.${node.id}`,
      message: "Swap node must have exactly one outgoing edge",
      friendlyMessage: FRIENDLY.SWAP_NEEDS_NEXT_STEP,
      code: "SWAP_NEEDS_NEXT_STEP",
      nodeId: node.id,
    });
  } else if (ctx.nextStepCount > 1) {
    issues.push({
      path: `nodes.${node.id}`,
      message: "Swap node can have at most one outgoing edge",
      friendlyMessage: FRIENDLY.SWAP_SINGLE_EDGE,
      code: "SWAP_SINGLE_EDGE",
      nodeId: node.id,
    });
  }

  return issues;
}
