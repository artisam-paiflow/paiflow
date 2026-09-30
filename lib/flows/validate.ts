import { TemplateKind } from "@prisma/client";
import { StrKey } from "@stellar/stellar-sdk";
import {
  FlowGraphSchema,
  type FlowGraph,
  type FlowNode,
  type Asset,
  type EdgeBranch,
  isAction,
  isContractAction,
  isLogic,
  isTrigger,
  isPendingAddress,
  isValidEmailAddress,
  migrateFlowGraph,
  splitTotalFixedStroops,
  subscriptionAmountPerPeriodStroops,
  assetLabel,
} from "./schema";
import type { FeatureFlags } from "@/lib/feature-flags";
import { isCatalogueAsset } from "./asset-catalogue";
import { hiddenSurfaceIssues } from "./feature-gates";
import type { ValidationIssue } from "./issue";
import { checkHardLimits } from "./limits";
import { swapConfigIssues, type SwapNode } from "./swap-rules";
import { addressIssues, isAcceptedFlowAddress } from "./address-rules";
import { SECRET_SEED_MESSAGE } from "./secret-seed";
import { inFlowOrder } from "./graph";
import { flowToPipeline, absorbedActionIds, type PipelineNode } from "./to-params";
import {
  BRANCH_LABEL,
  branchAmountText,
  branchTimeText,
  branchingNoun,
  conditionBranchTargets,
  isAmountCondition,
  isBranchingCondition,
  isTimeCondition,
  routerPathBranch,
  timelockSideBranch,
  type BranchingNoun as BranchNoun,
} from "./branches";

export type { ValidationIssue };

export type ValidationResult =
  | {
      ok: true;
      templateKind: TemplateKind;
      pipeline: TemplateKind[];
      graph: FlowGraph;
      pendingLabels: string[];
    }
  | { ok: false; errors: ValidationIssue[] };

const FRIENDLY = {
  EXACTLY_ONE_TRIGGER:
    "A flow can only have one trigger — either 'when I receive' or 'on a schedule', not both. Try splitting this into two separate flows.",
  NO_INCOMING_EDGES_TO_TRIGGER:
    "The trigger (start of your flow) can't have anything feeding into it. Remove any connections going into the trigger.",
  AT_LEAST_ONE_ACTION:
    "Your flow needs at least one action (a payment or split) after the trigger. Add a pay or split step.",
  CYCLE:
    "Your flow loops back on itself — steps can't feed into earlier steps. Remove the connection that creates the loop.",
  BPS_SUM: (got: number) =>
    `The percentages for your split don't add up to 100% (currently ${got / 100}%). Adjust them to total 100%.`,
  DUPLICATE_ADDRESS: (addr: string) =>
    `The address ${addr} appears more than once in your split recipients. Each recipient should only appear once.`,
  NODE_UNREACHABLE: (label: string) =>
    `${label} isn't connected to anything. Connect it to the trigger or another step.`,
  UNSUPPORTED_COMBO:
    "This trigger/action combination isn't supported. You can use: receive→pay, receive→split, schedule→pay, schedule→split, or add a condition to any of these.",
  MISSING_EDGE_SOURCE: (eid: string, src: string) =>
    `The connection "${eid}" references a node "${src}" that doesn't exist.`,
  MISSING_EDGE_TARGET: (eid: string, tgt: string) =>
    `The connection "${eid}" references a node "${tgt}" that doesn't exist.`,
  MIXED_SPLIT_MODE:
    "All recipients in a split must be either percentages or fixed amounts, not a mix.",
  FIXED_AMOUNT_REQUIRED: (recipients: { label?: string; address: string }[]) => {
    const names = recipients.map((r) => r.label?.trim() || r.address);
    return `Each fixed-amount recipient needs a positive amount: ${names.join(", ")}.`;
  },
  SHARE_REQUIRED: (recipients: { label?: string; address: string }[]) => {
    const names = recipients.map((r) => r.label?.trim() || r.address);
    return `Each recipient in a percentage split needs a share greater than 0%: ${names.join(", ")}. Enter a share, or remove the recipient.`;
  },
  TOTAL_FIXED_AMOUNT_REQUIRED: "Add at least one positive fixed amount to the split.",
  AMOUNT_PER_INTERVAL_REQUIRED:
    "A scheduled split needs an amount per interval — the total released each interval, divided among the recipients by their shares. Set it on the split step, or switch the recipients to fixed amounts (each then receives their amount every interval).",
  ASSET_CONFLICT:
    "This step can receive different assets depending on which path funds arrive through. Make sure every path leading into it carries the same asset, or add a swap so they match before merging.",
  DANGLING_NEXT_STEP: (label: string) =>
    `${label} is still connected as a next step, but it isn't part of the pipeline this flow would deploy. Remove the connection into it, or rebuild the steps in the order the money moves.`,
  ACTION_NOT_DEPLOYED: (label: string) =>
    `The ${label} step wouldn't reach the chain, so this flow would deploy as something you didn't draw. Rebuilding the steps in the order the money moves usually fixes it. If it doesn't, this trigger or condition can't carry that step and it has to go.`,
  YIELD_PARENT: (label: string) =>
    `A Yield step can only come straight after a Webhook, HTTP Webhook, or Oracle trigger for now, not after ${label}. Move it, or use a Pay or Split step here.`,
  ROUTER_EMPTY_PATH: (amounts: string, branch: EdgeBranch) =>
    `A payment of ${amounts} ${branch === "true" ? "meets" : "doesn't meet"} this amount condition, but nothing is connected to the condition's ${BRANCH_LABEL[branch]} output, so the money would be stuck in the contract with no way to get it back. Connect a step to the ${BRANCH_LABEL[branch]} output, or remove the condition.`,
  TIMELOCK_EMPTY_SIDE: (when: string, branch: EdgeBranch) =>
    `If the funds are released ${when}, this time condition would send them down its ${BRANCH_LABEL[branch]} output, but nothing is connected there, so the money would be stuck in the contract with no way to get it back. Connect a step to the ${BRANCH_LABEL[branch]} output, or remove the condition.`,
  BRANCH_FALSE_ON_SINGLE_OUTPUT:
    "Only amount and time conditions have a False output, and a step is still connected to this condition's. Remove that connection, or switch the condition back to an amount or time condition.",
  BRANCH_ON_NON_CONDITION: (label: string) =>
    `A connection out of ${label} is marked as a True or False branch, but only a condition has branches. Remove the connection and draw it again.`,
  BRANCH_FAN_OUT: (branch: EdgeBranch, count: number, noun: BranchNoun) =>
    `The ${BRANCH_LABEL[branch]} output of this ${noun} condition connects to ${count} steps. The condition sends the whole payment to every step on a side, so each side can lead to one step only. Keep one, and put a Split there to pay several recipients.`,
  BRANCH_EMAIL: (noun: BranchNoun) =>
    `An email notification can't hang off ${noun === "amount" ? "an amount" : "a time"} condition: the condition reports every payment, whichever side it takes, so the email couldn't say which side ran. Attach the email to the step on that side instead.`,
  BRANCH_TRIGGER: (label: string, noun: BranchNoun) =>
    `${noun === "amount" ? "An amount" : "A time"} condition can't follow ${label} yet: a scheduled payment has no ${noun} condition contract, so the condition would be skipped and every payment would go out. Remove the condition, or use a Receive trigger.`,
  BRANCH_TARGET: (noun: BranchNoun) =>
    `${noun === "amount" ? "An amount" : "A time"} condition's output can't lead straight into another condition. Connect each output to a Pay or Split step.`,
  BRANCH_MERGE: (label: string, noun: BranchNoun) =>
    `${label} is reached from both sides of ${noun === "amount" ? "an amount" : "a time"} condition through different steps. A step only accepts money from the one step before it, so one of the two sides would always fail. Give each side its own step.`,
  YIELD_TERMINAL:
    "A Yield step is the end of the line for now — nothing can come after it except an email notification. Remove the connections coming out of it.",
} as const;

// Triggers whose flows route payouts through the payer/splitter contracts,
// which support cash-out sinking for fiat recipients. on_schedule routes
// through the streamer, which has no cash-out mechanism.
export const FIAT_PAYOUT_TRIGGERS = new Set([
  "on_receive",
  "webhook",
  "web2_webhook",
  "oracle",
  "subscription",
  "payroll",
]);

// A short, self-describing name for a node, mirroring what the canvas shows so
// the user can locate the offending step instead of decoding a raw id like
// "swap-8j756t".
function nodeDescriptor(n: FlowNode): string {
  switch (n.type) {
    case "on_receive":
      return "Receive trigger";
    case "on_schedule":
      return "Schedule trigger";
    case "webhook":
      return "Webhook trigger";
    case "web2_webhook":
      return "HTTP Webhook trigger";
    case "subscription":
      return "Subscription trigger";
    case "payroll":
      return "Payroll";
    case "oracle":
      return "Oracle trigger";
    case "pay":
      return `Pay (${assetLabel(n.config.asset)})`;
    case "split":
      return `Split (${n.config.recipients.length} recipient${
        n.config.recipients.length === 1 ? "" : "s"
      })`;
    case "swap":
      return `Swap (${assetLabel(n.config.assetIn)} → ${assetLabel(n.config.assetOut)})`;
    case "yield":
      return `Yield (${assetLabel(n.config.asset)})`;
    case "cash_out":
      return "Cash Out";
    case "email_notify":
      return "Email notify";
    case "condition":
      return "Condition";
    default:
      return (n as FlowNode).type;
  }
}

// Build human-friendly labels for every node. When two nodes share the same
// descriptor (e.g. two "Swap (XLM → USDC)" steps), they're numbered so the user
// can still tell them apart.
function buildNodeLabels(graph: FlowGraph): Map<string, string> {
  const totals = new Map<string, number>();
  for (const n of graph.nodes) {
    const d = nodeDescriptor(n);
    totals.set(d, (totals.get(d) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const n of graph.nodes) {
    const d = nodeDescriptor(n);
    if ((totals.get(d) ?? 0) > 1) {
      const idx = (seen.get(d) ?? 0) + 1;
      seen.set(d, idx);
      labels.set(n.id, `${d} #${idx}`);
    } else {
      labels.set(n.id, d);
    }
  }
  return labels;
}

export function assetsEqual(a: Asset, b: Asset): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "known" && b.kind === "known") return a.symbol === b.symbol;
  if (a.kind === "custom" && b.kind === "custom") return a.code === b.code && a.issuer === b.issuer;
  return true; // both native
}

function getTriggerAsset(t: FlowNode): Asset | null {
  if (
    t.type === "on_receive" ||
    t.type === "webhook" ||
    t.type === "web2_webhook" ||
    t.type === "subscription" ||
    t.type === "payroll" ||
    t.type === "oracle"
  ) {
    return t.config.asset;
  }
  return null;
}

function uniqueAssets(assets: Asset[]): Asset[] {
  const out: Asset[] = [];
  for (const a of assets) {
    if (!out.some((o) => assetsEqual(o, a))) out.push(a);
  }
  return out;
}

/**
 * For every node in the graph, the asset expected to flow into it: the
 * trigger's asset, transformed to a swap's assetOut for anything downstream
 * of that swap. Null means unconstrained (no trigger asset, or unreachable).
 *
 * A node is only resolved once every one of its incoming edges has been
 * resolved (Kahn's algorithm), so a merge point that receives conflicting
 * assets via different paths is detected rather than silently settled by
 * whichever path the queue happened to visit first.
 */
function computeAssetFlowInternal(graph: FlowGraph): {
  resolved: Map<string, Asset | null>;
  conflicts: Set<string>;
} {
  const nodesById = new Map<string, FlowNode>(graph.nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const n of graph.nodes) {
    adj.set(n.id, []);
    indegree.set(n.id, 0);
  }
  for (const e of graph.edges) {
    adj.get(e.source)?.push(e.target);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }

  const resolved = new Map<string, Asset | null>();
  const conflicts = new Set<string>();
  const trigger = graph.nodes.find(isTrigger);
  if (!trigger) return { resolved, conflicts };

  const incoming = new Map<string, (Asset | null)[]>();
  const remaining = new Map(indegree);
  const visited = new Set<string>([trigger.id]);
  resolved.set(trigger.id, getTriggerAsset(trigger));
  const queue = [trigger.id];

  while (queue.length) {
    const nodeId = queue.shift()!;
    const node = nodesById.get(nodeId)!;
    const nodeIncoming = resolved.get(nodeId) ?? null;
    const outgoing = node.type === "swap" ? node.config.assetOut : nodeIncoming;

    for (const nextId of adj.get(nodeId) ?? []) {
      const list = incoming.get(nextId) ?? [];
      list.push(outgoing);
      incoming.set(nextId, list);
      remaining.set(nextId, (remaining.get(nextId) ?? 0) - 1);

      if ((remaining.get(nextId) ?? 0) <= 0 && !visited.has(nextId)) {
        visited.add(nextId);
        const distinct = uniqueAssets(
          (incoming.get(nextId) ?? []).filter((a): a is Asset => a !== null),
        );
        if (distinct.length > 1) {
          conflicts.add(nextId);
          resolved.set(nextId, null);
        } else {
          resolved.set(nextId, distinct[0] ?? null);
        }
        queue.push(nextId);
      }
    }
  }

  for (const n of graph.nodes) {
    if (!resolved.has(n.id)) resolved.set(n.id, null);
  }
  return { resolved, conflicts };
}

export function computeAssetFlow(graph: FlowGraph): Map<string, Asset | null> {
  return computeAssetFlowInternal(graph).resolved;
}

const GENERIC_SCHEMA_MESSAGE =
  "The flow structure is invalid. Check your node types and configuration.";

// True when the flow off-ramps to fiat anywhere: a cash-out sink node, a pay
// node paid out in fiat, or a split recipient paid out in fiat (both deploy
// an implicit cash-out contract). Shared by the validator and the builder
// toolbar.
export function flowHasFiatPayout(graph: FlowGraph): boolean {
  return graph.nodes.some(
    (n) =>
      n.type === "cash_out" ||
      (n.type === "pay" && n.config.payoutMode === "fiat") ||
      (n.type === "split" && n.config.recipients.some((r) => r.payoutMode === "fiat")),
  );
}

/**
 * Rules for the True/False branches of a condition (#720). The router behind
 * an amount condition transfers the whole amount to every step on the side it
 * takes, and each step only accepts a call from its one parent contract, so a
 * side must be a single chain of steps of its own.
 */
function branchIssues(
  graph: FlowGraph,
  nodesById: Map<string, FlowNode>,
  nodeLabels: Map<string, string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const e of graph.edges) {
    if (!e.sourceHandle) continue;
    const src = nodesById.get(e.source);
    if (!src) continue; // reported by the edge checks
    if (src.type !== "condition") {
      issues.push({
        path: `nodes.${src.id}`,
        code: "BRANCH_NOT_SUPPORTED",
        nodeId: src.id,
        message: `Edge ${e.id} leaves ${src.type} node ${src.id} on branch "${e.sourceHandle}"; only a condition has branches`,
        friendlyMessage: FRIENDLY.BRANCH_ON_NON_CONDITION(nodeLabels.get(src.id) ?? src.type),
      });
    } else if (e.sourceHandle === "false" && !isBranchingCondition(src)) {
      issues.push({
        path: `nodes.${src.id}`,
        code: "BRANCH_NOT_SUPPORTED",
        nodeId: src.id,
        message: `Edge ${e.id} leaves the false branch of a ${src.config.kind} condition, which has one output`,
        friendlyMessage: FRIENDLY.BRANCH_FALSE_ON_SINGLE_OUTPUT,
      });
    }
  }

  const onChainParents = new Map<string, Set<string>>();
  const onChainChildren = new Map<string, string[]>();
  for (const e of graph.edges) {
    const s = nodesById.get(e.source);
    const t = nodesById.get(e.target);
    if (!s || !t || s.type === "email_notify" || t.type === "email_notify") continue;
    onChainParents.set(t.id, (onChainParents.get(t.id) ?? new Set()).add(s.id));
    onChainChildren.set(s.id, [...(onChainChildren.get(s.id) ?? []), t.id]);
  }

  const trigger = graph.nodes.find(isTrigger);
  const scheduleLike =
    trigger?.type === "on_schedule" ||
    trigger?.type === "subscription" ||
    trigger?.type === "payroll";

  for (const cond of graph.nodes) {
    if (!isBranchingCondition(cond)) continue;
    const noun = branchingNoun(cond.config.kind);

    // Schedule-like flows compile to a streamer or subscription and never emit
    // the router, so the gate the user drew would silently not exist.
    if (scheduleLike && trigger) {
      issues.push({
        path: `nodes.${cond.id}`,
        code: "BRANCH_TRIGGER",
        nodeId: cond.id,
        message: `${noun} condition ${cond.id} under a ${trigger.type} trigger is not compiled`,
        friendlyMessage: FRIENDLY.BRANCH_TRIGGER(nodeLabels.get(trigger.id) ?? trigger.type, noun),
      });
    }

    const targets = conditionBranchTargets(graph, cond.id);
    for (const id of [...targets.true, ...targets.false]) {
      if (nodesById.get(id)?.type !== "condition") continue;
      issues.push({
        path: `nodes.${cond.id}`,
        code: "BRANCH_TARGET",
        nodeId: cond.id,
        message: `Condition ${id} is a direct branch target of ${noun} condition ${cond.id}`,
        friendlyMessage: FRIENDLY.BRANCH_TARGET(noun),
      });
    }

    if (
      graph.edges.some(
        (e) => e.source === cond.id && nodesById.get(e.target)?.type === "email_notify",
      )
    ) {
      issues.push({
        path: `nodes.${cond.id}`,
        code: "BRANCH_EMAIL",
        nodeId: cond.id,
        message: `Email notify node attached to ${noun} condition ${cond.id}`,
        friendlyMessage: FRIENDLY.BRANCH_EMAIL(noun),
      });
    }

    for (const branch of ["true", "false"] as const) {
      if (targets[branch].length > 1) {
        issues.push({
          path: `nodes.${cond.id}`,
          code: "BRANCH_FAN_OUT",
          nodeId: cond.id,
          message: `The ${branch} branch of condition ${cond.id} has ${targets[branch].length} next steps; the contract forwards the whole amount to each`,
          friendlyMessage: FRIENDLY.BRANCH_FAN_OUT(branch, targets[branch].length, noun),
        });
      }
    }

    // A step downstream of the condition with two different parents: its
    // contract stores one parent, so the call from the other one is refused
    // on chain. Both outputs straight into the same step is fine, since the
    // condition is the parent either way.
    const seen = new Set<string>();
    const stack = [...targets.true, ...targets.false];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if ((onChainParents.get(id)?.size ?? 0) > 1) {
        issues.push({
          path: `nodes.${id}`,
          code: "BRANCH_MERGE",
          nodeId: id,
          message: `Node ${id} downstream of condition ${cond.id} has more than one parent`,
          friendlyMessage: FRIENDLY.BRANCH_MERGE(nodeLabels.get(id) ?? id, noun),
        });
      }
      stack.push(...(onChainChildren.get(id) ?? []));
    }
  }

  return issues;
}

export type ValidateFlowOptions = {
  /**
   * The surfaces switched on for this server (#722). Omitted means every
   * surface is on, which is right for saving a draft; anything that leads to a
   * deploy passes `serverFeatures()` (or, in the builder, the flags the page
   * handed down) so a hidden block is refused on its node.
   */
  features?: FeatureFlags;
};

export function validateFlow(rawGraph: unknown, opts: ValidateFlowOptions = {}): ValidationResult {
  const result = validateFlowStructure(rawGraph);
  if (!opts.features) return result;
  // A graph that fails to parse has no nodes to check; its schema errors stand.
  const graph = result.ok
    ? result.graph
    : FlowGraphSchema.safeParse(migrateFlowGraph(rawGraph)).data;
  if (!graph) return result;
  const gated = hiddenSurfaceIssues(graph, opts.features);
  if (gated.length === 0) return result;
  // With the off-ramp off there is no KYC to collect (the button is hidden),
  // so the KYC rule would be an instruction the user cannot follow.
  const offramp = opts.features.offramp;
  const rest = result.ok ? [] : result.errors.filter((e) => offramp || e.path !== "senderKyc");
  return { ok: false, errors: [...gated, ...rest] };
}

function validateFlowStructure(rawGraph: unknown): ValidationResult {
  const migrated = migrateFlowGraph(rawGraph);
  const parsed = FlowGraphSchema.safeParse(migrated);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
        friendlyMessage:
          i.message === SECRET_SEED_MESSAGE ? SECRET_SEED_MESSAGE : GENERIC_SCHEMA_MESSAGE,
      })),
    };
  }
  const graph = parsed.data;
  const errors: ValidationIssue[] = [];
  const pendingLabels = new Set<string>();

  const nodesById = new Map<string, FlowNode>(graph.nodes.map((n) => [n.id, n]));
  const nodeLabels = buildNodeLabels(graph);

  for (const e of graph.edges) {
    if (!nodesById.has(e.source)) {
      errors.push({
        path: `edges.${e.id}`,
        message: `Unknown source ${e.source}`,
        friendlyMessage: FRIENDLY.MISSING_EDGE_SOURCE(e.id, e.source),
      });
    }
    if (!nodesById.has(e.target)) {
      errors.push({
        path: `edges.${e.id}`,
        message: `Unknown target ${e.target}`,
        friendlyMessage: FRIENDLY.MISSING_EDGE_TARGET(e.id, e.target),
      });
    }
  }
  if (errors.length) return { ok: false, errors };

  // Any string parses as an address so autosave keeps a half-typed one (#588);
  // this is the check that keeps it from deploying.
  errors.push(...addressIssues(graph));

  const triggers = graph.nodes.filter(isTrigger);
  if (triggers.length !== 1) {
    errors.push({
      path: "nodes",
      message: "Flow must have exactly one trigger node",
      friendlyMessage: FRIENDLY.EXACTLY_ONE_TRIGGER,
    });
  }
  const actions = graph.nodes.filter(isAction);
  // Flow order, so the template ladder below infers the kind from the action
  // the trigger reaches first rather than the one added to the canvas first.
  const contractActions = inFlowOrder(graph, actions.filter(isContractAction));
  if (contractActions.length < 1) {
    errors.push({
      path: "nodes",
      message: "Flow must have at least one action node",
      friendlyMessage: FRIENDLY.AT_LEAST_ONE_ACTION,
    });
  }

  for (const a of actions) {
    if (a.type === "split") {
      // A scheduled split compiles to a streamer whose per-interval base is
      // amountPerIntervalStroops — percentage recipients only define
      // distribution (bps), so without it the pipeline silently falls back to
      // 1 stroop per interval (streamerAmountPerInterval in to-params.ts),
      // deploying a dust stream. Fixed-mode recipients are exempt: their base
      // is derived as the sum of their per-interval amounts. The amount is
      // baked into the contract constructor, so this is required even in dev
      // mode (API-filled recipients can't supply it).
      const allFixed =
        a.config.recipients.length > 0 && a.config.recipients.every((r) => r.mode === "fixed");
      if (
        triggers[0]?.type === "on_schedule" &&
        !allFixed &&
        (!a.config.amountPerIntervalStroops || a.config.amountPerIntervalStroops === "0")
      ) {
        errors.push({
          path: `nodes.${a.id}.config.amountPerIntervalStroops`,
          message: "Scheduled split requires a positive amount per interval",
          friendlyMessage: FRIENDLY.AMOUNT_PER_INTERVAL_REQUIRED,
        });
      }

      // Dev mode allows leaving recipients empty to fill via API after deploy.
      if (graph.devMode === true && a.config.recipients.length === 0) {
        continue;
      }

      if (a.config.recipients.length === 0) {
        errors.push({
          path: `nodes.${a.id}.config.recipients`,
          message: "Split node must have at least one recipient",
          friendlyMessage: "Add at least one recipient to the split node.",
        });
        continue;
      }

      const modes = new Set(a.config.recipients.map((r) => r.mode));
      if (modes.size > 1) {
        errors.push({
          path: `nodes.${a.id}.config.recipients`,
          message: "Split recipients must all use the same mode (percentage or fixed)",
          friendlyMessage: FRIENDLY.MIXED_SPLIT_MODE,
        });
      }

      const mode = a.config.recipients[0]?.mode ?? "percentage";

      if (mode === "percentage") {
        // The schema lets a 0 share parse so the panel can autosave a cleared
        // field (#583). It must never reach the splitter: its constructor only
        // checks the sum, so a 0 entry deploys, and as the last recipient it
        // would be paid the rounding remainder of everyone else's share.
        const zeroShare = a.config.recipients.filter((r) => r.mode === "percentage" && r.bps <= 0);
        if (zeroShare.length > 0) {
          errors.push({
            path: `nodes.${a.id}.config.recipients`,
            message: `Every percentage recipient needs a share greater than 0 bps (${zeroShare.length} at 0)`,
            friendlyMessage: FRIENDLY.SHARE_REQUIRED(zeroShare),
          });
        }
        const sum = a.config.recipients.reduce(
          (s, r) => (r.mode === "percentage" ? s + r.bps : s),
          0,
        );
        if (sum !== 10_000) {
          errors.push({
            path: `nodes.${a.id}.config.recipients`,
            message: `Recipient basis points must sum to 10000 (got ${sum})`,
            friendlyMessage: FRIENDLY.BPS_SUM(sum),
          });
        }
      } else {
        const zeroAmountRecipients: { label?: string; address: string }[] = [];
        for (const [idx, r] of a.config.recipients.entries()) {
          if (r.mode === "fixed" && (!r.amountStroops || r.amountStroops === "0")) {
            zeroAmountRecipients.push(r);
            continue;
          }
          // Min/max amount caps are a fiat off-ramp constraint (PDAX limits).
          // Crypto payouts are not subject to them.
          if (r.mode === "fixed" && r.amountStroops && r.payoutMode === "fiat") {
            const limitIssue = checkHardLimits(a.config.asset, r.amountStroops);
            if (limitIssue) {
              errors.push({
                path: `nodes.${a.id}.config.recipients.${idx}.amountStroops`,
                message: limitIssue.message,
                friendlyMessage: `${r.label ?? r.address}: ${limitIssue.friendlyMessage}`,
              });
            }
          }
        }
        if (zeroAmountRecipients.length > 0) {
          errors.push({
            path: `nodes.${a.id}.config.recipients`,
            message: `Fixed recipient amount must be positive for ${zeroAmountRecipients.length} recipient(s)`,
            friendlyMessage: FRIENDLY.FIXED_AMOUNT_REQUIRED(zeroAmountRecipients),
          });
        }
        const total = splitTotalFixedStroops(a.config.recipients);
        if (!total || total === "0") {
          errors.push({
            path: `nodes.${a.id}.config.recipients`,
            message: "Total fixed amount must be greater than 0",
            friendlyMessage: FRIENDLY.TOTAL_FIXED_AMOUNT_REQUIRED,
          });
        }
      }

      const seen = new Set<string>();
      for (const r of a.config.recipients) {
        const isContract = StrKey.isValidContract(r.address);
        const isFiat = r.payoutMode === "fiat";
        const triggerType = triggers[0]?.type;

        // Native fiat payouts sink through the payer/splitter cash-out path,
        // available for receive/webhook/oracle/subscription/payroll flows.
        // Contract addresses (C...) point to an explicit cash-out node
        // downstream and are always allowed. Dev mode supports native fiat
        // only for payroll — the rest is deferred. The recipient's wallet
        // address is irrelevant for fiat (a cash-out contract is generated at
        // deploy time), so this gate applies to wallet and pending addresses
        // alike.
        if (isFiat && !isContract) {
          if (!triggerType || !FIAT_PAYOUT_TRIGGERS.has(triggerType)) {
            errors.push({
              path: `nodes.${a.id}.config.recipients`,
              message: "Wallet addresses cannot use fiat payout in this flow",
              friendlyMessage:
                "Fiat payout for wallet addresses is available in receive, webhook, oracle, subscription, and payroll flows. Use a cash-out node for off-ramp here, or switch the address to crypto.",
            });
          } else if (graph.devMode === true && triggerType !== "payroll") {
            errors.push({
              path: `nodes.${a.id}.config.recipients`,
              message: "Fiat payout outside payroll is not yet supported in dev mode",
              friendlyMessage:
                "Turn off dev mode to pay fiat to wallet addresses in this flow, or use a cash-out node.",
            });
          } else if (graph.devMode !== true && triggerType !== "payroll") {
            // Immutable contracts bake the bank destination in at deploy time.
            // Payroll recipients are exempt: their bank details live in the
            // Employee table and are resolved when each payroll run executes.
            // Dev mode may leave the details blank and configure via the API.
            const missing = [];
            if (!r.accountName?.trim()) missing.push("account name");
            if (!r.accountNumber?.trim()) missing.push("account number");
            if (!r.bankCode?.trim()) missing.push("bank code");
            if (missing.length) {
              errors.push({
                path: `nodes.${a.id}.config.recipients`,
                message: `Fiat recipient is missing ${missing.join(", ")}`,
                friendlyMessage: `Enter the ${missing.join(", ")} for this fiat recipient.`,
              });
            }
          }
        }

        if (isPendingAddress(r.address)) {
          // Fiat recipients get an auto-generated cash-out contract at deploy
          // time, so a pending wallet address is not required up front.
          if (!isFiat) {
            pendingLabels.add(r.label ?? "unnamed");
          }
        } else if (isAcceptedFlowAddress(r.address, "account_or_contract")) {
          // A blank or half-typed address is reported by addressIssues; two
          // blank rows are not also a "duplicate" (#588).
          if (seen.has(r.address)) {
            errors.push({
              path: `nodes.${a.id}.config.recipients`,
              message: `Duplicate address ${r.address} in split recipients`,
              friendlyMessage: FRIENDLY.DUPLICATE_ADDRESS(r.address),
            });
          }
          seen.add(r.address);
        }
      }
    }
    if (a.type === "pay") {
      if (isPendingAddress(a.config.recipient)) {
        // Fiat pay recipients get an auto-generated cash-out contract at deploy
        // time, so a pending wallet address is not required up front.
        if (a.config.payoutMode !== "fiat") {
          pendingLabels.add(a.config.recipient.slice(8) || "unnamed");
        }
      }
      if (a.config.payoutMode === "fiat") {
        const triggerType = triggers[0]?.type;
        if (!triggerType || !FIAT_PAYOUT_TRIGGERS.has(triggerType)) {
          errors.push({
            path: `nodes.${a.id}.config.payoutMode`,
            message: "Fiat payout for pay nodes is not supported in this flow",
            friendlyMessage:
              "Native fiat payout on a pay step is available in receive, webhook, oracle, subscription, and payroll flows. Use a cash-out node for off-ramp here, or switch to crypto.",
          });
        } else if (graph.devMode === true && triggerType !== "payroll") {
          errors.push({
            path: `nodes.${a.id}.config.payoutMode`,
            message: "Fiat payout outside payroll is not yet supported in dev mode",
            friendlyMessage:
              "Turn off dev mode to pay fiat on a pay step in this flow, or use a cash-out node.",
          });
        } else if (graph.devMode !== true) {
          const missing = [];
          if (!a.config.accountName?.trim()) missing.push("account name");
          if (!a.config.accountNumber?.trim()) missing.push("account number");
          if (!a.config.bankCode?.trim()) missing.push("bank code");
          if (missing.length) {
            errors.push({
              path: `nodes.${a.id}.config.payoutMode`,
              message: `Fiat pay recipient is missing ${missing.join(", ")}`,
              friendlyMessage: `Enter the ${missing.join(", ")} for this fiat recipient.`,
            });
          }
        }
      }
      if (a.config.fillValueViaApi && graph.devMode !== true) {
        errors.push({
          path: `nodes.${a.id}.config.fillValueViaApi`,
          message: "Fill value via API is only allowed in dev mode",
          friendlyMessage: "Turn on dev mode to fill the payment value via API after deploy.",
        });
      }
      const valueDeferred = graph.devMode === true && a.config.fillValueViaApi;
      if (!valueDeferred && !a.config.fullAmount) {
        if (
          a.config.mode === "fixed" &&
          (!a.config.amountStroops || a.config.amountStroops === "0")
        ) {
          errors.push({
            path: `nodes.${a.id}.config.amountStroops`,
            message: "Pay node in fixed mode requires a positive amount",
            friendlyMessage: "Please enter a positive amount for the pay node.",
          });
        } else if (
          a.config.mode === "fixed" &&
          a.config.amountStroops &&
          a.config.payoutMode === "fiat"
        ) {
          // Min/max amount caps are a fiat off-ramp constraint (PDAX limits).
          // Crypto payouts are not subject to them.
          const limitIssue = checkHardLimits(a.config.asset, a.config.amountStroops);
          if (limitIssue) {
            errors.push({
              path: `nodes.${a.id}.config.amountStroops`,
              message: limitIssue.message,
              friendlyMessage: limitIssue.friendlyMessage,
            });
          }
        }
        if (
          a.config.mode === "percentage" &&
          (a.config.percentage === undefined || a.config.percentage <= 0)
        ) {
          errors.push({
            path: `nodes.${a.id}.config.percentage`,
            message: "Pay node in percentage mode requires a positive percentage",
            friendlyMessage: "Please enter a positive percentage for the pay node.",
          });
        }
      }
    }
    if (a.type === "yield" && isPendingAddress(a.config.vault)) {
      pendingLabels.add(a.config.vault.slice(8) || "unnamed");
    }
  }

  // Non-dev flows with fiat payouts must carry the sender KYC profile at
  // design time: PDAX requires it for every off-ramp, and without it the
  // off-ramp cron would cancel the very first payout job. Dev flows are
  // exempt (they submit it via the API after deploy) — same pattern as the
  // recipient bank-detail rules above.
  if (graph.devMode !== true && flowHasFiatPayout(graph) && !graph.senderKyc) {
    errors.push({
      path: "senderKyc",
      message: "Sender KYC is required before deploying a flow with fiat payouts.",
      friendlyMessage: "Add the sender KYC details from the toolbar (required to deploy).",
    });
  }

  // A yield node can only be entered through `receive_and_forward`: the crate
  // has no `execute_step`, which is what the deposit trigger, payer, splitter,
  // swapper, timelock and router call on their next steps, so a yield behind
  // any of those deploys and then reverts on the first run. It also forwards
  // `amount = 0` downstream, which every next-step contract rejects. Until #158
  // gives it an execute_step and a real forward, only a receive_and_forward
  // trigger may feed it and nothing on-chain may follow it. multisig and
  // subscription dispatch receive_and_forward too, but neither pipeline has
  // been exercised with a yield in it (the conditional wrapper, and the
  // relayer-driven per-period charge), so both stay out of the allowlist.
  const YIELD_PARENT_TYPES = new Set(["webhook", "web2_webhook", "oracle"]);
  for (const n of graph.nodes) {
    if (n.type !== "yield") continue;
    for (const e of graph.edges) {
      if (e.target !== n.id) continue;
      const src = nodesById.get(e.source);
      // A missing source is reported by the edge checks above.
      if (!src || YIELD_PARENT_TYPES.has(src.type)) continue;
      errors.push({
        path: `nodes.${n.id}`,
        message: `Yield node cannot follow a ${src.type} node`,
        friendlyMessage: FRIENDLY.YIELD_PARENT(nodeLabels.get(src.id) ?? src.type),
      });
    }
    const outgoing = graph.edges.filter(
      (e) => e.source === n.id && nodesById.get(e.target)?.type !== "email_notify",
    );
    if (outgoing.length > 0) {
      errors.push({
        path: `nodes.${n.id}`,
        message: "Yield node cannot have next steps",
        friendlyMessage: FRIENDLY.YIELD_TERMINAL,
      });
    }
  }

  // Swap rules live in swap-rules.ts so the panel and the tests read the same
  // ones. Only on-chain children count as next steps: getPipelineChildren in
  // to-params.ts drops every edge touching an email_notify node, so those
  // never become next steps and `swap -> pay` plus `swap -> email_notify`
  // still constructs with exactly one.
  const swaps = graph.nodes.filter((n): n is SwapNode => n.type === "swap");
  if (swaps.length) {
    const assetFlow = computeAssetFlow(graph);
    const triggerAsset = triggers[0] ? getTriggerAsset(triggers[0]) : null;
    for (const n of swaps) {
      const nextStepCount = graph.edges.filter(
        (e) => e.source === n.id && nodesById.get(e.target)?.type !== "email_notify",
      ).length;
      errors.push(
        ...swapConfigIssues(n, {
          nextStepCount,
          incomingAsset: assetFlow.get(n.id) ?? null,
          triggerAsset,
        }),
      );
    }
  }

  // Email notify nodes are decorator leaves — they cannot have children.
  for (const n of graph.nodes) {
    if (n.type === "email_notify") {
      const hasOutgoing = graph.edges.some((e) => e.source === n.id);
      if (hasOutgoing) {
        errors.push({
          path: `nodes.${n.id}`,
          message: "Email notify node cannot have outgoing edges",
          friendlyMessage:
            "Email notify nodes can't be connected to other steps. Remove any connections coming out of it.",
        });
      }

      const parentEdge = graph.edges.find((e) => e.target === n.id);
      const parent = parentEdge ? nodesById.get(parentEdge.source) : undefined;

      // The schema lets a row through with its email still blank or half typed
      // (the config panel writes one row per split recipient before any email
      // is entered), so this block is the only thing standing between such a
      // row and the Resend call in notifications.ts. A blank row reads as "not
      // filled in yet" and is reported once, under whichever rule names it best.
      const filledRows = n.config.recipients.filter((r) => r.email.trim() !== "");
      let unreportedBlankRows = n.config.recipients.filter((r) => r.email.trim() === "");

      if (parent?.type === "split") {
        const parentAddresses = parent.config.recipients.map((r) => r.address);
        const emailAddresses = n.config.recipients.map((r) => r.address);
        const filledAddresses = filledRows.map((r) => r.address);
        // When the split is in dev mode and its recipients are left empty to be
        // filled via API, we can't validate a 1:1 address mapping yet.
        const splitFilledViaApi = graph.devMode === true && parentAddresses.length === 0;
        if (!splitFilledViaApi && emailAddresses.length !== parentAddresses.length) {
          errors.push({
            path: `nodes.${n.id}.config.recipients`,
            message: "Email notify node must have exactly one email per split recipient",
            friendlyMessage:
              "Add exactly one email for each address in the split. Remove or fill any blank rows.",
          });
        }
        if (!splitFilledViaApi) {
          for (const addr of parentAddresses) {
            if (!filledAddresses.includes(addr)) {
              errors.push({
                path: `nodes.${n.id}.config.recipients`,
                message: `Missing email for split recipient ${addr}`,
                friendlyMessage: `Add an email for split recipient ${addr}.`,
              });
            }
          }
          const missingAddresses = parentAddresses.filter((a) => !filledAddresses.includes(a));
          unreportedBlankRows = unreportedBlankRows.filter(
            (r) => !missingAddresses.includes(r.address),
          );
        }
      } else if (filledRows.length === 0) {
        errors.push({
          path: `nodes.${n.id}.config.recipients`,
          message: "Email notify node requires at least one recipient",
          friendlyMessage: "Add at least one recipient email to the email notify node.",
        });
        unreportedBlankRows = [];
      }

      if (unreportedBlankRows.length > 0) {
        errors.push({
          path: `nodes.${n.id}.config.recipients`,
          message: "Email notify node has a recipient with no email address",
          friendlyMessage: "Fill in or remove the blank recipient row on the email notify node.",
        });
      }

      for (const r of filledRows) {
        if (!isValidEmailAddress(r.email)) {
          errors.push({
            path: `nodes.${n.id}.config.recipients`,
            message: `Invalid email address: ${r.email}`,
            friendlyMessage: `"${r.email}" isn't a valid email address. Check it for typos.`,
          });
        }
      }

      if (!n.config.subject.trim()) {
        errors.push({
          path: `nodes.${n.id}.config.subject`,
          message: "Email notify node requires a subject",
          friendlyMessage: "Add a subject line to the email notify node.",
        });
      }
    }
  }

  // The conditional contract (oracle_gte) pays recipients directly and cannot
  // sink cash-out shares, so native fiat payouts are incompatible with it.
  // Explicit cash-out nodes are fine — they receive funds via forwarding.
  const hasOracleGteCondition = graph.nodes.some(
    (n) => n.type === "condition" && n.config.kind === "oracle_gte",
  );
  if (hasOracleGteCondition) {
    const hasNativeFiatPayout = graph.nodes.some(
      (n) =>
        (n.type === "pay" && n.config.payoutMode === "fiat") ||
        (n.type === "split" && n.config.recipients.some((r) => r.payoutMode === "fiat")),
    );
    if (hasNativeFiatPayout) {
      errors.push({
        path: "nodes",
        message: "Fiat payouts are not compatible with oracle-gte conditions",
        friendlyMessage:
          "Oracle conditions pay recipients directly and cannot cash out to a bank. Remove the condition, switch the payout to crypto, or use an explicit cash-out node instead.",
      });
    }
  }

  // Cash-out nodes are terminal sinks: funds leave the chain, so they cannot
  // feed another node and must receive funds from an upstream node. Bank details
  // may be left blank in dev mode (filled via API after deploy), but must be set
  // at design time in non-dev mode.
  for (const n of graph.nodes) {
    if (n.type !== "cash_out") continue;

    const hasOutgoing = graph.edges.some((e) => e.source === n.id);
    if (hasOutgoing) {
      errors.push({
        path: `nodes.${n.id}`,
        message: "Cash-out node cannot have outgoing edges",
        friendlyMessage:
          "Cash-out is a final step — its output leaves the chain. Remove any connections coming out of it.",
      });
    }

    const hasIncoming = graph.edges.some((e) => e.target === n.id);
    if (!hasIncoming) {
      errors.push({
        path: `nodes.${n.id}`,
        message: "Cash-out node must receive funds from an upstream node",
        friendlyMessage:
          "Connect a pay or split step into the cash-out node so it has funds to send to the bank.",
      });
    }

    if (graph.devMode !== true) {
      if (!n.config.accountName || n.config.accountName.trim().length === 0) {
        errors.push({
          path: `nodes.${n.id}.config.accountName`,
          message: "Cash-out account name is required in non-dev mode",
          friendlyMessage: "Enter the beneficiary account name for the cash-out node.",
        });
      }
      if (!n.config.accountNumber || n.config.accountNumber.trim().length === 0) {
        errors.push({
          path: `nodes.${n.id}.config.accountNumber`,
          message: "Cash-out account number is required in non-dev mode",
          friendlyMessage: "Enter the beneficiary account number for the cash-out node.",
        });
      }
      if (!n.config.bankCode) {
        errors.push({
          path: `nodes.${n.id}.config.bankCode`,
          message: "Cash-out bank is required in non-dev mode",
          friendlyMessage: "Select a bank for the cash-out node.",
        });
      }
    }
  }

  // Validate multisig thresholds
  for (const n of graph.nodes) {
    if (n.type === "condition" && n.config.kind === "multisig") {
      if (n.config.threshold > n.config.signers.length) {
        errors.push({
          path: `nodes.${n.id}.config.threshold`,
          message: `Threshold (${n.config.threshold}) cannot exceed number of signers (${n.config.signers.length})`,
          friendlyMessage: `Multisig threshold cannot be larger than the number of signers (${n.config.signers.length}).`,
        });
      }
    }
  }

  errors.push(...branchIssues(graph, nodesById, nodeLabels));

  // Detect cycles via DFS
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) adj.get(e.source)!.push(e.target);
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>(graph.nodes.map((n) => [n.id, WHITE]));
  function dfs(id: string): boolean {
    color.set(id, GRAY);
    for (const next of adj.get(id) ?? []) {
      const c = color.get(next);
      if (c === GRAY) return true;
      if (c === WHITE && dfs(next)) return true;
    }
    color.set(id, BLACK);
    return false;
  }
  for (const n of graph.nodes) {
    if (color.get(n.id) === WHITE && dfs(n.id)) {
      errors.push({
        path: "edges",
        message: "Flow contains a cycle",
        friendlyMessage: FRIENDLY.CYCLE,
      });
      break;
    }
  }

  const trigger = triggers[0];
  if (trigger) {
    const hasIncoming = graph.edges.some((e) => e.target === trigger.id);
    if (hasIncoming) {
      errors.push({
        path: "nodes",
        message: "Trigger node must have no incoming edges",
        friendlyMessage: FRIENDLY.NO_INCOMING_EDGES_TO_TRIGGER,
      });
    }
  }

  // A subscription that pulls 0 is meaningless. When it feeds an all-fixed
  // split the pull is derived from the fixed recipient sum (the UI hides the
  // manual field then); otherwise the configured amount must be positive. In
  // dev mode the amount may be left blank to be filled via the API after
  // deploy, so only enforce this for real deployments.
  if (trigger?.type === "subscription" && graph.devMode !== true) {
    const amount = subscriptionAmountPerPeriodStroops(graph);
    if (!amount || BigInt(amount) <= 0n) {
      errors.push({
        path: `nodes.${trigger.id}.config.amountPerPeriodStroops`,
        message: "Subscription amount per period must be greater than 0",
        friendlyMessage:
          "Set an amount per period greater than 0 — a subscription that pulls nothing will never charge.",
      });
    }
  }

  // The streamer/subscription/payroll constructors reject a window whose end
  // is not after its start. The builder clamps a past start up to "now" at
  // deploy time (to-params.ts), so an endsAt that is in the past — or earlier
  // than a future startsAt — always deploys into a contract rejection. Catch
  // it here instead. Payroll with fillScheduleViaApi deploys a far-future
  // placeholder schedule, so its configured endsAt is irrelevant.
  if (
    trigger &&
    (trigger.type === "on_schedule" ||
      trigger.type === "subscription" ||
      trigger.type === "payroll")
  ) {
    const cfg = trigger.config as {
      startsAt?: string;
      endsAt?: string;
      fillScheduleViaApi?: boolean;
    };
    const scheduleFilledViaApi = trigger.type === "payroll" && cfg.fillScheduleViaApi === true;
    if (cfg.endsAt && !scheduleFilledViaApi) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const startSeconds =
        trigger.type === "on_schedule" && cfg.startsAt
          ? Math.max(nowSeconds, Math.floor(new Date(cfg.startsAt).getTime() / 1000))
          : nowSeconds;
      const endSeconds = Math.floor(new Date(cfg.endsAt).getTime() / 1000);
      if (endSeconds <= startSeconds) {
        errors.push({
          path: `nodes.${trigger.id}.config.endsAt`,
          message: "Schedule end time must be after its start time",
          friendlyMessage:
            endSeconds <= nowSeconds
              ? "This schedule's end time has already passed. Pick an end date in the future."
              : "This schedule's end time is before its start time. Move the end date later.",
        });
      }
    }
  }

  // Payroll flows must use fixed amounts so the contract can compute the
  // exact pull amount per period.
  if (trigger?.type === "payroll") {
    for (const a of contractActions) {
      if (a.type === "split") {
        const modes = new Set(a.config.recipients.map((r) => r.mode));
        if (modes.has("percentage")) {
          errors.push({
            path: `nodes.${a.id}.config.recipients`,
            message: "Payroll split must use fixed amounts, not percentages",
            friendlyMessage:
              "Payroll distributions must be fixed salary amounts. Switch all recipients to fixed amounts.",
          });
        }
      }
      if (a.type === "pay" && a.config.mode === "percentage") {
        errors.push({
          path: `nodes.${a.id}.config.mode`,
          message: "Payroll pay node must use fixed amount, not percentage",
          friendlyMessage:
            "Payroll distributions must be fixed salary amounts. Switch the pay node to a fixed amount.",
        });
      }
    }
  }

  // Reachability from trigger
  if (trigger) {
    const seen = new Set<string>([trigger.id]);
    const stack = [trigger.id];
    while (stack.length) {
      const id = stack.pop()!;
      for (const next of adj.get(id) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    // Every node, not just the actions. A condition dropped on the canvas and
    // never wired still makes the template ladder pick CONDITIONAL and still
    // compiles to a pipeline node, so the flow deploys as something the user
    // didn't draw — see the dangling-next-step guard below for what that costs.
    for (const n of graph.nodes) {
      if (n.id === trigger.id) continue;
      if (!seen.has(n.id)) {
        errors.push({
          path: `nodes.${n.id}`,
          message: `Node ${n.id} is not reachable from the trigger`,
          friendlyMessage: FRIENDLY.NODE_UNREACHABLE(nodeLabels.get(n.id) ?? n.id),
        });
      }
    }
  }

  if (errors.length) return { ok: false, errors };

  // Asset type enforcement: every contract action must declare the asset that
  // actually flows into it (the trigger's asset, transformed to a swap's
  // assetOut for anything downstream of that swap).
  if (trigger) {
    const { resolved: expectedAssetByNode, conflicts } = computeAssetFlowInternal(graph);

    for (const nodeId of conflicts) {
      errors.push({
        path: `nodes.${nodeId}`,
        message: "Asset conflict: multiple incoming paths provide different assets",
        friendlyMessage: FRIENDLY.ASSET_CONFLICT,
      });
    }

    for (const a of contractActions) {
      const expected = expectedAssetByNode.get(a.id);
      if (!expected) continue; // unconstrained: no trigger asset, unreachable, or conflicting (reported above)

      let actual: Asset | null = null;
      if (a.type === "pay") actual = a.config.asset;
      else if (a.type === "split") actual = a.config.asset;
      else if (a.type === "yield") actual = a.config.asset;
      else if (a.type === "swap") {
        // swapConfigIssues names the trigger for this; "Change Asset In to
        // <custom>" is advice the catalogue rule would then refuse.
        if (!isCatalogueAsset(expected)) continue;
        actual = a.config.assetIn;
      }

      if (actual && !assetsEqual(expected, actual)) {
        errors.push({
          path: `nodes.${a.id}.config.${a.type === "swap" ? "assetIn" : "asset"}`,
          message: `Asset mismatch: action uses ${assetLabel(actual)} but ${assetLabel(expected)} flows in`,
          friendlyMessage:
            a.type === "swap"
              ? `Asset mismatch: this swap's "Asset In" is set to ${assetLabel(actual)}, but ${assetLabel(expected)} actually flows into it. Change "Asset In" to ${assetLabel(expected)}.`
              : `Asset mismatch: ${assetLabel(expected)} flows into this step, but this action uses ${assetLabel(actual)}. Change the action asset to ${assetLabel(expected)}, or add a swap node to convert assets first.`,
        });
      }
    }
  }

  if (errors.length) return { ok: false, errors };

  // Infer template kind from contract actions only.
  const action = contractActions[0]!;
  const condition = graph.nodes.find(isLogic);
  const hasCondition = condition != null;
  const isScheduleLike = trigger!.type === "on_schedule" || trigger!.type === "subscription";
  const isOnReceive = trigger!.type === "on_receive";
  const isWebhookLike =
    trigger!.type === "webhook" || trigger!.type === "web2_webhook" || trigger!.type === "oracle";
  const isReceiveLike = isOnReceive || isWebhookLike;
  const isPayOrSplit = action.type === "pay" || action.type === "split";
  const isSwapOrYield = action.type === "swap" || action.type === "yield";
  const isCashOut = action.type === "cash_out";

  if (isWebhookLike && hasCondition && condition.config.kind !== "multisig") {
    return {
      ok: false,
      errors: [
        {
          path: "nodes",
          message: "Webhook and oracle triggers are only compatible with multisig conditions.",
          friendlyMessage:
            "This trigger type only supports multisig conditions. Try removing the condition or changing it to multisig.",
        },
      ],
    };
  }

  let templateKind: TemplateKind;
  if (hasCondition) {
    templateKind = TemplateKind.CONDITIONAL;
  } else if (trigger!.type === "subscription" && isPayOrSplit) {
    templateKind = TemplateKind.SUBSCRIPTION;
  } else if (trigger!.type === "payroll" && isPayOrSplit) {
    templateKind = TemplateKind.PAYROLL;
  } else if (trigger!.type === "on_schedule" && isPayOrSplit) {
    templateKind = TemplateKind.STREAMER;
  } else if (isOnReceive && isPayOrSplit) {
    templateKind = TemplateKind.SPLITTER;
  } else if (isOnReceive && isCashOut) {
    templateKind = TemplateKind.CASH_OUT;
  } else if (isOnReceive && isSwapOrYield) {
    templateKind = action.type === "swap" ? TemplateKind.SWAPPER : TemplateKind.YIELD;
  } else if (isWebhookLike && isPayOrSplit) {
    templateKind = TemplateKind.SPLITTER;
  } else if (isWebhookLike && isSwapOrYield) {
    templateKind = action.type === "swap" ? TemplateKind.SWAPPER : TemplateKind.YIELD;
  } else if (trigger!.type === "oracle") {
    templateKind = TemplateKind.CONDITIONAL;
  } else {
    return {
      ok: false,
      errors: [
        {
          path: "nodes",
          message:
            "Unsupported trigger/action combination. Supported: on_receive with pay/split/swap/yield/cash_out, webhook/web2_webhook/oracle with pay/split/swap/yield/multisig, schedule-like triggers (on_schedule, subscription) with pay/split, payroll with pay/split, or any with a compatible condition.",
          friendlyMessage: FRIENDLY.UNSUPPORTED_COMBO,
        },
      ],
    };
  }

  // Compute pipeline mapping
  let pipelineNodes: PipelineNode[];
  let pipeline: TemplateKind[];
  try {
    pipelineNodes = flowToPipeline(graph);
    pipeline = pipelineNodes.map((n) => n.templateKind);
    if (pipeline.length === 0) {
      return {
        ok: false,
        errors: [
          {
            path: "nodes",
            message: "Flow could not be mapped to a contract pipeline",
            friendlyMessage:
              "This flow shape isn't supported by the current contract architecture. Try a simpler trigger → action chain.",
          },
        ],
      };
    }
  } catch {
    return {
      ok: false,
      errors: [
        {
          path: "nodes",
          message: "Flow could not be mapped to a contract pipeline",
          friendlyMessage:
            "This flow shape isn't supported by the current contract architecture. Try a simpler trigger → action chain.",
        },
      ],
    };
  }

  // Every contract action the user drew must actually reach the chain. Both the
  // template ladder above and flowToPipeline pick "the" action as
  // contractActions[0], in flow order via inFlowOrder() — the action the trigger
  // reaches first along the edges, so the pipeline follows what the user drew
  // rather than the order they dropped the blocks. That is not enough on its
  // own: an action can still end up neither emitted nor absorbed, and a
  // schedule flow with two chained pays is the live example — the streamer
  // carries one payout step, so the second pay reaches no contract and that
  // recipient is never paid. Catch it here rather than letting money move
  // against a pipeline the user didn't draw.
  //
  // "Not emitted" is not the same as "lost": an oracle_gte condition compiles to
  // a CONDITIONAL that owns the recipients and pays them itself, so its pay or
  // split is absorbed on purpose. absorbedActionIds() carries that rule, and
  // lives beside the code that applies it.
  const deployedNodeIds = new Set(pipelineNodes.map((n) => n.nodeId));
  const absorbed = absorbedActionIds(graph);
  for (const a of contractActions) {
    if (deployedNodeIds.has(a.id) || absorbed.has(a.id)) continue;
    errors.push({
      path: `nodes.${a.id}`,
      message: `Action ${a.id} (${a.type}) is not represented in the deployed pipeline`,
      friendlyMessage: FRIENDLY.ACTION_NOT_DEPLOYED(nodeLabels.get(a.id) ?? a.type),
    });
  }

  // The router picks path A or path B and forwards the whole amount down it. An
  // empty path is a silent no-op on chain: the funds already sit in the router,
  // which has no withdraw, so they are lost. Refuse any router the pipeline
  // would deploy with a path it could take and nothing on it (#719). The paths
  // are filled from the condition's True/False branches (#720), so this fires
  // on a branch left unconnected, once per missing branch, naming it.
  for (const n of pipelineNodes) {
    const p = n.params;
    if (p.kind !== "router") continue;
    const cond = graph.nodes.find((g) => g.id === n.nodeId);
    for (const path of ["A", "B"] as const) {
      const ids = path === "A" ? p.pathANodeIds : p.pathBNodeIds;
      if (ids.length > 0) continue;
      // Only an amount condition compiles to a router; the fallback is defensive.
      const branch: EdgeBranch = isAmountCondition(cond)
        ? routerPathBranch(cond.config.kind, path)
        : path === "A"
          ? "true"
          : "false";
      const amounts = isAmountCondition(cond)
        ? branchAmountText(cond.config, branch, ` ${assetLabel(p.asset)}`)
        : "some amounts";
      errors.push({
        path: `nodes.${n.nodeId}`,
        code: "ROUTER_EMPTY_PATH",
        nodeId: n.nodeId,
        message: `Router ${n.nodeId} has an empty path ${path} (the ${branch} branch); funds routed there would be stranded`,
        friendlyMessage: FRIENDLY.ROUTER_EMPTY_PATH(amounts, branch),
      });
    }
  }

  // The two-outcome timelock pays the whole balance to its "before" or "after"
  // step, whichever the release time picks, and has no other way out. A side
  // with nothing on it would leave the funds in the contract (#721), so refuse
  // it, once per missing side, naming the output. The contract's constructor
  // refuses the same shape; this reports it before anything is signed.
  for (const n of pipelineNodes) {
    const p = n.params;
    if (p.kind !== "timelock_branch") continue;
    const cond = graph.nodes.find((g) => g.id === n.nodeId);
    for (const side of ["before", "after"] as const) {
      const ids = side === "before" ? p.beforeNodeIds : p.afterNodeIds;
      if (ids.length > 0) continue;
      // Only a time condition compiles to this contract; the fallback is defensive.
      const branch: EdgeBranch = isTimeCondition(cond)
        ? timelockSideBranch(cond.config.kind, side)
        : side === "before"
          ? "true"
          : "false";
      const when = isTimeCondition(cond)
        ? branchTimeText(cond.config, branch)
        : `${side === "before" ? "before" : "at or after"} the deadline`;
      errors.push({
        path: `nodes.${n.nodeId}`,
        code: "TIMELOCK_EMPTY_SIDE",
        nodeId: n.nodeId,
        message: `Timelock ${n.nodeId} has an empty ${side} list (the ${branch} branch); funds released ${side === "before" ? "before" : "at or after"} the deadline would be stranded`,
        friendlyMessage: FRIENDLY.TIMELOCK_EMPTY_SIDE(when, branch),
      });
    }
  }

  // The same set, read the other way round: a pipeline node may not point at a
  // node that was never emitted. deploy.ts builds its address map from the
  // emitted nodes alone, so workflowTargets in scval.ts throws "Missing
  // computed address" on any such reference — a 500 from /deployments/prepare
  // on a flow the builder called valid. An oracle_gte conditional is where
  // this bites today (it goes terminal and absorbs its action, while the
  // trigger may still name that action directly), but the guard is the general
  // precondition, not that one shape.
  for (const n of pipelineNodes) {
    const p = n.params as {
      nextStepNodeIds?: string[];
      pathANodeIds?: string[];
      pathBNodeIds?: string[];
      beforeNodeIds?: string[];
      afterNodeIds?: string[];
    };
    for (const ref of [
      ...(p.nextStepNodeIds ?? []),
      ...(p.pathANodeIds ?? []),
      ...(p.pathBNodeIds ?? []),
      ...(p.beforeNodeIds ?? []),
      ...(p.afterNodeIds ?? []),
    ]) {
      if (deployedNodeIds.has(ref)) continue;
      errors.push({
        path: `nodes.${ref}`,
        message: `Pipeline node ${n.nodeId} points at ${ref}, which is not in the deployed pipeline`,
        friendlyMessage: FRIENDLY.DANGLING_NEXT_STEP(nodeLabels.get(ref) ?? ref),
      });
    }
  }

  if (errors.length) return { ok: false, errors };

  return { ok: true, templateKind, pipeline, graph, pendingLabels: [...pendingLabels] };
}
