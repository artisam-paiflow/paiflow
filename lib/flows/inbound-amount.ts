import {
  type Asset,
  type FlowGraph,
  type FlowNode,
  isTrigger,
  splitTotalFixedStroops,
} from "./schema";
import { assetsEqual, computeAssetFlow } from "./validate";

/**
 * How much the sender has to put into a flow for it to execute the way it was
 * configured.
 *
 * Distinct from `sourceAmountStroops` in schema.ts, which reports what the
 * *trigger declares* (a minimum, a threshold, a per-period pull). This reports
 * what the deployed pipeline will actually *consume*, by adding up the fixed
 * payouts along the chain.
 *
 * It matters because over-funding is silently absorbed rather than refused. A
 * fixed payer pays `min(incoming, configured)` and forwards the rest to its
 * next step (contracts/actions/payer/src/lib.rs:96-105); a terminal payer has
 * no next step, so the surplus is stranded in the contract with only the
 * admin-only `cancel()` to get it back. Locking the trigger amount to an
 * `exact` requirement is what keeps that from happening.
 */
export type InboundRequirement =
  /** The pipeline consumes exactly this much; anything more would strand. */
  | { kind: "exact"; stroops: string; asset: Asset }
  /** At least this much; whatever is above it is consumed proportionally. */
  | { kind: "minimum"; stroops: string; asset: Asset }
  /** Nothing determinate to say — any positive amount is valid. */
  | { kind: "variable" };

const VARIABLE: InboundRequirement = { kind: "variable" };

/**
 * What one node takes out of the value passing through it:
 * a fixed number of stroops, or an amount that depends on what arrives.
 */
function consumption(node: FlowNode): bigint | "variable" | "none" {
  switch (node.type) {
    case "pay": {
      const c = node.config;
      // A percentage (including `fullAmount`, which compiles to 10_000 bps) is
      // taken from whatever arrives, and a value filled in via the API after
      // deploy isn't in this graph at all.
      if (c.fullAmount || c.fillValueViaApi || c.mode === "percentage") return "variable";
      return BigInt(c.amountStroops ?? "0");
    }
    case "split": {
      const total = splitTotalFixedStroops(node.config.recipients);
      // `null` means no fixed recipient at all, i.e. a percentage split, whose
      // bps sum to 10_000 and so consume everything that reaches it.
      return total === null ? "variable" : BigInt(total);
    }
    // A swap changes the denomination, a yield vault deposits whatever arrives,
    // and a cash-out sinks its whole share to the off-ramp treasury.
    case "swap":
    case "yield":
    case "cash_out":
      return "variable";
    // A gate can stop the flow outright, so nothing past it is guaranteed.
    case "condition":
      return "variable";
    default:
      return "none";
  }
}

/**
 * Pipeline children of each node, skipping `email_notify` — off-chain
 * decorators that are never wired as contract next steps. Mirrors
 * `getPipelineChildren` in to-params.ts, which decides the real wiring.
 */
function pipelineChildren(graph: FlowGraph): Map<string, string[]> {
  const emailIds = new Set(graph.nodes.filter((n) => n.type === "email_notify").map((n) => n.id));
  const children = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) {
    if (emailIds.has(e.source) || emailIds.has(e.target)) continue;
    children.get(e.source)?.push(e.target);
  }
  return children;
}

export function inboundRequirement(graph: FlowGraph): InboundRequirement {
  // Dev-mode amounts are filled in after deploy through the dev-* routes, so
  // what the graph holds is not what the contract holds.
  if (graph.devMode === true) return VARIABLE;

  const trigger = graph.nodes.find(isTrigger);
  // Only an on_receive deposit is one sender funding the whole pipeline in a
  // single call. Every other trigger is pulled by the relayer on a schedule or
  // fired by an external event, so no amount typed here governs it.
  if (trigger?.type !== "on_receive") return VARIABLE;
  const triggerAsset = trigger.config.asset;

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const assetOf = computeAssetFlow(graph);
  const children = pipelineChildren(graph);

  let fixedTotal = 0n;
  let variable = false;

  // Follow the single chain the value actually takes. A branch is not a chain:
  // the contracts disagree about what to do with one (a payer forwards its
  // remainder to `next_steps[0]` alone, while a deposit trigger sends the full
  // amount to every step), so a total across branches would be a guess.
  const seen = new Set<string>([trigger.id]);
  let cursor: string | undefined = trigger.id;
  while (cursor) {
    const next: string[] = children.get(cursor) ?? [];
    if (next.length > 1) {
      variable = true;
      break;
    }
    cursor = next[0];
    if (!cursor || seen.has(cursor)) break;
    seen.add(cursor);

    const node = byId.get(cursor);
    if (!node) break;

    const takes = consumption(node);
    if (takes === "variable") {
      variable = true;
      break;
    }
    if (takes === "none") continue;

    // Past a swap the amounts are denominated in another asset, so they can't
    // be added to a total the sender pays in the trigger's asset.
    const nodeAsset = assetOf.get(cursor);
    if (!nodeAsset || !assetsEqual(nodeAsset, triggerAsset)) {
      variable = true;
      break;
    }

    fixedTotal += takes;
  }

  if (fixedTotal <= 0n) return VARIABLE;

  // The trigger's declared minimum is enforced on-chain by the splitter
  // (contracts/actions/splitter/src/lib.rs:118-121), so it raises the floor —
  // it never lowers one the payouts themselves already set.
  const declaredMin = trigger.config.minAmountStroops
    ? BigInt(trigger.config.minAmountStroops)
    : 0n;

  if (!variable) {
    // A minimum above what the chain consumes contradicts it: the exact total
    // would be refused on-chain, and anything large enough to pass would
    // strand the difference. The flow is misconfigured — don't name a loser.
    if (declaredMin > fixedTotal) return VARIABLE;
    return { kind: "exact", stroops: fixedTotal.toString(), asset: triggerAsset };
  }

  const floor = declaredMin > fixedTotal ? declaredMin : fixedTotal;
  return { kind: "minimum", stroops: floor.toString(), asset: triggerAsset };
}
