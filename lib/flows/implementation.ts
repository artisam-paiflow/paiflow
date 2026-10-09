import { z } from "zod";
import type { FlowGraph, FlowNode } from "./schema";
import type { ValidationIssue } from "./issue";
import type { PipelineNodeParams } from "./to-params";
import { edgeBranch, isTimeCondition, timelockSideBranch } from "./branches";

const BlockTypeSchema = z.enum([
  "on_receive",
  "on_schedule",
  "webhook",
  "web2_webhook",
  "subscription",
  "payroll",
  "oracle",
  "pay",
  "split",
  "swap",
  "yield",
  "cash_out",
  "condition",
  "hold",
  "return_to_owner",
  "email_notify",
]);
const BindingBaseSchema = z.object({ blockId: z.string().min(1), blockType: BlockTypeSchema });
export const BlockBindingSchema = z.discriminatedUnion("role", [
  BindingBaseSchema.extend({
    role: z.enum(["trigger", "action", "condition", "schedule", "distribution", "strict_lock"]),
  }).strict(),
  BindingBaseSchema.extend({
    role: z.literal("payout_sink"),
    recipientIndex: z.number().int().nonnegative(),
  }).strict(),
]);
export const PipelineImplementationSchema = z
  .object({
    version: z.literal(1),
    bindings: z.array(BlockBindingSchema).min(1).max(40),
  })
  .strict();
export type BlockBinding = z.infer<typeof BlockBindingSchema>;
export type PipelineImplementation = z.infer<typeof PipelineImplementationSchema>;

export function directBinding(node: FlowNode): BlockBinding {
  return {
    blockId: node.id,
    blockType: node.type,
    role:
      node.type === "condition"
        ? "condition"
        : ["on_receive", "webhook", "web2_webhook", "subscription", "payroll", "oracle"].includes(
              node.type,
            )
          ? "trigger"
          : "action",
  };
}

function directTemplateMatches(block: FlowNode, templateKind: string): boolean {
  switch (block.type) {
    case "on_receive":
      return templateKind === "DEPOSIT_TRIGGER";
    case "webhook":
    case "web2_webhook":
      return templateKind === "WEBHOOK";
    case "subscription":
      return ["SUBSCRIPTION", "SUBSCRIPTION_DEV"].includes(templateKind);
    case "payroll":
      return ["PAYROLL", "SUBSCRIPTION", "SUBSCRIPTION_DEV"].includes(templateKind);
    case "oracle":
      return templateKind === "ORACLE";
    case "pay":
      return ["PAYER", "PAYER_DEV"].includes(templateKind);
    case "return_to_owner":
      return templateKind === "PAYER";
    case "split":
      return ["SPLITTER", "SPLITTER_DEV"].includes(templateKind);
    case "swap":
      return templateKind === "SWAPPER";
    case "yield":
      return templateKind === "YIELD";
    case "cash_out":
      return ["CASH_OUT", "CASH_OUT_DEV"].includes(templateKind);
    case "condition":
      switch (block.config.kind) {
        case "time_after":
        case "time_before":
          return ["TIMELOCK", "TIMELOCK_BRANCH"].includes(templateKind);
        case "amount_gt":
        case "amount_lt":
          return templateKind === "ROUTER";
        case "oracle_gte":
          return templateKind === "CONDITIONAL";
        case "multisig":
          return templateKind === "MULTISIG";
        default: {
          const exhaustive: never = block.config;
          return exhaustive;
        }
      }
    case "hold":
    case "on_schedule":
    case "email_notify":
      return false;
    default: {
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}

function reachesBlock(graph: FlowGraph, sourceId: string, targetId: string): boolean {
  const seen = new Set([sourceId]);
  const queue = [sourceId];
  while (queue.length) {
    const current = queue.pop()!;
    for (const edge of graph.edges) {
      if (edge.source !== current) continue;
      if (edge.target === targetId) return true;
      if (seen.has(edge.target)) continue;
      seen.add(edge.target);
      queue.push(edge.target);
    }
  }
  return false;
}

function roleMatches(
  graph: FlowGraph,
  block: FlowNode,
  binding: Exclude<BlockBinding, { role: "payout_sink" }>,
  node: { nodeId: string; templateKind: string },
  blocks: Map<string, FlowNode>,
): boolean {
  switch (binding.role) {
    case "strict_lock": {
      const condition = blocks.get(node.nodeId);
      const edge = graph.edges.find(
        (edge) => edge.source === node.nodeId && edge.target === block.id,
      );
      return (
        block.type === "hold" &&
        node.templateKind === "TIMELOCK" &&
        isTimeCondition(condition) &&
        !!edge &&
        edgeBranch(edge, condition) === timelockSideBranch(condition.config.kind, "before")
      );
    }
    case "schedule":
      return (
        block.type === "on_schedule" &&
        node.templateKind === "STREAMER" &&
        reachesBlock(graph, block.id, node.nodeId)
      );
    case "distribution": {
      if (block.type !== "pay" && block.type !== "split") return false;
      if (node.templateKind === "STREAMER") return block.id === node.nodeId;
      const condition = blocks.get(node.nodeId);
      return (
        node.templateKind === "CONDITIONAL" &&
        condition?.type === "condition" &&
        condition.config.kind === "oracle_gte" &&
        reachesBlock(graph, node.nodeId, block.id)
      );
    }
    case "condition":
      return (
        block.type === "condition" &&
        block.id === node.nodeId &&
        directTemplateMatches(block, node.templateKind)
      );
    case "trigger":
      return (
        directBinding(block).role === "trigger" &&
        block.id === node.nodeId &&
        directTemplateMatches(block, node.templateKind)
      );
    case "action":
      return (
        directBinding(block).role === "action" &&
        block.id === node.nodeId &&
        directTemplateMatches(block, node.templateKind)
      );
    default: {
      const exhaustive: never = binding.role;
      return exhaustive;
    }
  }
}

/** Checks the compiler's recorded coverage; never invent bindings for a deployed graph. */
export function implementationIssues(
  graph: FlowGraph,
  pipeline: Array<{
    nodeId: string;
    templateKind: string;
    implementation?: unknown;
    params?: PipelineNodeParams;
  }>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const blocks = new Map(graph.nodes.map((n) => [n.id, n]));
  const covered = new Set<string>();
  const contractIds = new Set<string>();
  const payoutReferences = new Map<string, { blockId: string; recipientIndex: number }>();
  const payoutBindings = new Map<string, number>();
  // Dev non-payroll compilation preserves existing cash-out contract recipients.
  // Their addresses are validated by the graph validator; they are dependencies,
  // not contracts generated/deployed by this pipeline.
  const generatesPayouts =
    graph.devMode !== true || graph.nodes.some((node) => node.type === "payroll");
  const report = (id: string, message: string) =>
    issues.push({
      path: `nodes.${id}`,
      nodeId: id,
      code: "IMPLEMENTATION_MAPPING",
      message,
      friendlyMessage: message,
    });
  for (const node of pipeline) {
    const params = node.params;
    const recipients =
      params?.kind === "payer" || params?.kind === "payer_dev"
        ? [{ address: params.recipient, isCashOut: params.isCashOut }]
        : params?.kind === "splitter" || params?.kind === "splitter_dev"
          ? params.recipients
          : [];
    for (const [recipientIndex, recipient] of recipients.entries()) {
      if (!generatesPayouts || !recipient.isCashOut) continue;
      if (!recipient.address || payoutReferences.has(recipient.address)) {
        report(
          node.nodeId,
          "A generated payout contract has a missing or duplicate recipient reference.",
        );
        continue;
      }
      payoutReferences.set(recipient.address, { blockId: node.nodeId, recipientIndex });
    }
  }
  for (const node of pipeline) {
    if (contractIds.has(node.nodeId))
      report(node.nodeId, "Two deployed contracts have the same pipeline ID.");
    contractIds.add(node.nodeId);
    const parsed = PipelineImplementationSchema.safeParse(node.implementation);
    if (!parsed.success) {
      report(node.nodeId, "This contract has an invalid implementation mapping.");
      continue;
    }
    const bindings = parsed.data.bindings;
    const generated = bindings.some((binding) => binding.role === "payout_sink");
    const hasOwner =
      node.templateKind === "STREAMER"
        ? bindings.some((binding) => binding.role === "schedule") &&
          bindings.some(
            (binding) => binding.role === "distribution" && binding.blockId === node.nodeId,
          )
        : bindings.some(
            (binding) =>
              ["trigger", "action", "condition"].includes(binding.role) &&
              binding.blockId === node.nodeId,
          );
    if (generated ? bindings.length !== 1 : !hasOwner) {
      report(node.nodeId, "This contract is missing a valid originating block binding.");
    }
    const seen = new Set<string>();
    for (const binding of parsed.data.bindings) {
      const block = blocks.get(binding.blockId);
      const key = `${binding.blockId}:${binding.role}:${binding.role === "payout_sink" ? binding.recipientIndex : ""}`;
      if (seen.has(key))
        report(binding.blockId, "This contract repeats an implementation binding.");
      seen.add(key);
      if (!block || block.type !== binding.blockType) {
        report(
          binding.blockId,
          "An implementation binding references a missing or different block.",
        );
        continue;
      }
      if (binding.role === "payout_sink") {
        const originKey = JSON.stringify([binding.blockId, binding.recipientIndex]);
        payoutBindings.set(originKey, (payoutBindings.get(originKey) ?? 0) + 1);
        const reference = payoutReferences.get(node.nodeId);
        const params = node.params;
        const recipient =
          block.type === "pay" && binding.recipientIndex === 0
            ? block.config
            : block.type === "split"
              ? block.config.recipients[binding.recipientIndex]
              : undefined;
        if (
          !recipient ||
          recipient.payoutMode !== "fiat" ||
          !["CASH_OUT", "CASH_OUT_DEV"].includes(node.templateKind) ||
          reference?.blockId !== block.id ||
          reference.recipientIndex !== binding.recipientIndex ||
          (params?.kind !== "cash_out" && params?.kind !== "cash_out_dev") ||
          params.parentNodeId !== block.id
        ) {
          report(block.id, "A generated payout contract has an invalid recipient binding.");
        }
        continue;
      }
      const valid = roleMatches(graph, block, binding, node, blocks);
      if (!valid) report(block.id, "This block has an invalid implementation role.");
      else covered.add(block.id);
    }
  }
  for (const [contractId, reference] of payoutReferences) {
    const child = pipeline.find((node) => node.nodeId === contractId);
    const parsed = PipelineImplementationSchema.safeParse(child?.implementation);
    if (
      !child ||
      !parsed.success ||
      !parsed.data.bindings.some(
        (binding) =>
          binding.role === "payout_sink" &&
          binding.blockId === reference.blockId &&
          binding.recipientIndex === reference.recipientIndex,
      )
    ) {
      report(
        reference.blockId,
        "A generated payout recipient is missing its contract implementation binding.",
      );
    }
  }
  for (const block of graph.nodes) {
    const recipients =
      block.type === "pay" ? [block.config] : block.type === "split" ? block.config.recipients : [];
    for (const [recipientIndex, recipient] of recipients.entries()) {
      if (!generatesPayouts || recipient.payoutMode !== "fiat") continue;
      if (payoutBindings.get(JSON.stringify([block.id, recipientIndex])) !== 1) {
        report(
          block.id,
          "Each fiat recipient must have exactly one generated payout contract binding.",
        );
      }
    }
    if (covered.has(block.id)) continue;
    report(
      block.id,
      `The ${block.type.replaceAll("_", " ")} step wouldn't reach the chain. Its behavior must be represented before this flow can deploy.`,
    );
  }
  return issues;
}

/** Display recorded block associations without looking up the current editable flow. */
export function implementationLabel(value: unknown): string | null {
  const parsed = PipelineImplementationSchema.safeParse(value);
  if (!parsed.success) return null;
  const names: Record<FlowNode["type"], string> = {
    on_receive: "Receive",
    on_schedule: "Schedule",
    webhook: "Webhook",
    web2_webhook: "HTTP Webhook",
    subscription: "Subscription",
    payroll: "Payroll",
    oracle: "Oracle",
    pay: "Pay",
    split: "Split",
    swap: "Swap",
    yield: "Yield",
    cash_out: "Cash out",
    condition: "Condition",
    hold: "Hold",
    return_to_owner: "Return to owner",
    email_notify: "Email",
  };
  return parsed.data.bindings
    .map((b) =>
      b.role === "payout_sink"
        ? `${names[b.blockType]} recipient ${b.recipientIndex + 1} payout`
        : b.role === "strict_lock"
          ? "Hold until deadline"
          : names[b.blockType],
    )
    .join(" + ");
}
