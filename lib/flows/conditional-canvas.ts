import type { TemplateKind } from "@prisma/client";
import { ConditionalCanvasSchema, type ConditionalCanvas } from "./conditional-canvas-schema";
import {
  ConditionalDefinitionSchema,
  ConditionalConditionSchema,
  ConditionalPayNodeSchema,
  ConditionalSplitNodeSchema,
  NonnegativeStroopsSchema,
  type ConditionalDefinition,
  type ConditionalPayNode,
  type ConditionalSplitNode,
} from "./conditional-v2";
import { PolicyIdSchema, REUSABLE_LIMITS, type NodeFieldPolicy } from "./field-policies";
import { pctToBps, assetLabel, type FlowNode } from "./schema";
import { assertConditionalArtifact } from "@/lib/stellar/conditional-artifacts";

export type ConditionalCanvasIssue = { nodeId?: string; message: string };
function layout(draft: ConditionalCanvas) {
  const roots = draft.nodes.filter((n) => n.type === "on_receive"),
    conditions = draft.nodes.filter((n) => n.type === "condition");
  if (roots.length !== 1 || conditions.length !== 1)
    throw new Error("Use exactly one Receive and one amount condition.");
  const root = roots[0]!,
    condition = conditions[0]!,
    byId = new Map(draft.nodes.map((n) => [n.id, n]));
  for (const n of draft.nodes) PolicyIdSchema.parse(n.id);
  if (draft.edges.some((e) => !byId.has(e.source) || !byId.has(e.target)))
    throw new Error("Every edge must connect existing blocks.");
  const incoming = (id: string) => draft.edges.filter((e) => e.target === id),
    outgoing = (id: string) => draft.edges.filter((e) => e.source === id);
  if (incoming(root.id).length) throw new Error("Receive must be the only root.");
  const prefix: Extract<FlowNode, { type: "pay" }>[] = [],
    visited = new Set([root.id]);
  let current: FlowNode = root;
  while (current.id !== condition.id) {
    const edges = outgoing(current.id);
    if (edges.length !== 1 || edges[0]!.sourceHandle !== undefined)
      throw new Error("Receive and upstream Pay blocks need one unbranched successor.");
    const next = byId.get(edges[0]!.target)!;
    if (visited.has(next.id) || incoming(next.id).length !== 1)
      throw new Error("Conditional flows cannot cycle or join.");
    visited.add(next.id);
    if (next.id !== condition.id) {
      if (next.type !== "pay")
        throw new Error("Only sequential Pay blocks may precede the condition.");
      prefix.push(next);
    }
    current = next;
  }
  const branches = outgoing(condition.id);
  if (
    branches.length !== 2 ||
    branches.filter((e) => e.sourceHandle === "true").length !== 1 ||
    branches.filter((e) => e.sourceHandle === "false").length !== 1
  )
    throw new Error("The condition needs explicit True and False branches.");
  const terminal = (branch: "true" | "false") => {
    const n = byId.get(branches.find((e) => e.sourceHandle === branch)!.target)!;
    if (
      !["pay", "split", "return_to_owner"].includes(n.type) ||
      visited.has(n.id) ||
      incoming(n.id).length !== 1 ||
      outgoing(n.id).length
    )
      throw new Error("Each branch must end in its own terminal Pay, Split or Return to owner.");
    visited.add(n.id);
    return n;
  };
  const yes = terminal("true"),
    no = terminal("false");
  if (visited.size !== draft.nodes.length || draft.edges.length !== draft.nodes.length - 1)
    throw new Error("Every block must belong to the complete conditional flow.");
  if (
    root.type !== "on_receive" ||
    condition.type !== "condition" ||
    (condition.config.kind !== "amount_gt" && condition.config.kind !== "amount_lt")
  )
    throw new Error("Unsupported conditional topology.");
  for (const n of draft.nodes)
    if (
      (n.type === "pay" || n.type === "split") &&
      JSON.stringify(n.config.asset) !== JSON.stringify(root.config.asset)
    )
      throw new Error("All blocks must use the Receive asset.");
  return { root, condition, prefix, yes, no };
}
function policy(
  draft: ConditionalCanvas,
  node: Extract<FlowNode, { type: "pay" | "split" }>,
): NodeFieldPolicy {
  const declared = draft.conditionalPolicies.nodes.find((p) => p.nodeId === node.id);
  if (declared) return declared;
  if (node.type === "pay")
    return { kind: "pay", nodeId: node.id, recipient: "constant", payoutValue: "constant" };
  return {
    kind: "split",
    nodeId: node.id,
    allocationMode: node.config.recipients[0]?.mode ?? "percentage",
    additionalRecipients: "constant",
    rows: node.config.recipients.map((r, i) => ({
      rowId: r.rowId ?? `row-${i + 1}`,
      recipient: "constant",
      allocation: "constant",
    })),
  };
}
function payment(
  draft: ConditionalCanvas,
  node: FlowNode,
): ConditionalPayNode | ConditionalSplitNode {
  if (node.type !== "pay" && node.type !== "split") throw new Error("Expected Pay or Split.");
  const p = policy(draft, node);
  if (node.type === "pay" && p.kind === "pay") {
    const value = node.config.fullAmount
      ? { kind: "full" as const }
      : node.config.mode === "percentage"
        ? { kind: "percentage" as const, bps: pctToBps(node.config.percentage ?? 0) }
        : { kind: "fixed" as const, amountStroops: node.config.amountStroops };
    return ConditionalPayNodeSchema.parse({
      kind: "pay",
      nodeId: node.id,
      policy: p,
      configuration: {
        kind: "pay",
        ...(p.recipient === "execution" ? {} : { recipient: node.config.recipient }),
        payoutValue: value,
      },
    });
  }
  if (node.type !== "split" || p.kind !== "split")
    throw new Error("Payment policy kind differs from its block.");
  if (
    node.config.amountPerIntervalStroops !== undefined ||
    node.config.ratePerSecondStroops !== undefined
  )
    throw new Error("Delayed or recurring Split terms are outside conditional payments.");
  if (node.config.additionalRecipients !== undefined && p.additionalRecipients !== "mutable")
    throw new Error("Initial additional recipients require a mutable roster declaration.");
  const configuredRows = node.config.recipients.map((r, i) => {
    const declared = p.rows[i];
    if (
      !declared ||
      r.mode !== p.allocationMode ||
      (r.rowId !== undefined && r.rowId !== declared.rowId)
    )
      throw new Error(
        "Configured Split identities and allocation mode must match their declaration.",
      );
    return {
      rowId: declared.rowId,
      ...(declared.recipient === "execution" ? {} : { recipient: r.address }),
      ...(declared.allocation === "execution"
        ? {}
        : {
            allocation:
              r.mode === "fixed"
                ? { kind: "fixed", amountStroops: r.amountStroops }
                : { kind: "percentage", bps: r.bps },
          }),
    };
  });
  return ConditionalSplitNodeSchema.parse({
    kind: "split",
    nodeId: node.id,
    policy: p,
    configuration: {
      kind: "split",
      configuredRows,
      additionalRecipients: node.config.additionalRecipients ?? [],
    },
  });
}
/** Intrinsic financial checks need no invented deployment owner or token address.
 * The strict normalized domain is checked again with real identities at deployment. */
function financial(n: ConditionalPayNode | ConditionalSplitNode) {
  if (n.kind === "pay") {
    if (n.configuration.payoutValue.kind === "full" && n.policy.payoutValue !== "constant")
      throw new Error("Full Pay cannot declare a mutable payout value.");
    return;
  }
  const rows = [...n.configuration.configuredRows, ...n.configuration.additionalRecipients],
    p = n.policy;
  if (
    n.configuration.configuredRows.length !== p.rows.length ||
    (!rows.length && p.additionalRecipients !== "execution") ||
    rows.length > 20 ||
    new Set(rows.map((r) => r.rowId)).size !== rows.length ||
    new Set(rows.flatMap((r) => (r.recipient ? [r.recipient] : []))).size !==
      rows.filter((r) => r.recipient !== undefined).length
  )
    throw new Error("Invalid Split recipient roster or row identity.");
  if (rows.some((r) => r.allocation && r.allocation.kind !== p.allocationMode))
    throw new Error("Split allocation mode is immutable.");
  if (p.allocationMode === "fixed") {
    if (
      rows.reduce(
        (s, r) => s + (r.allocation?.kind === "fixed" ? BigInt(r.allocation.amountStroops) : 0n),
        0n,
      ) > BigInt(REUSABLE_LIMITS.maxStroops)
    )
      throw new Error("Stored Split total exceeds i128.");
  } else {
    const total = rows.reduce(
        (s, r) => s + (r.allocation?.kind === "percentage" ? r.allocation.bps : 0),
        0,
      ),
      slots = rows.filter((r) => !r.allocation).length;
    if (
      total + slots > 10000 ||
      (!slots && p.additionalRecipients !== "execution" && total !== 10000)
    )
      throw new Error(
        "Split percentages must conserve 10000 bps and leave room for declared inputs.",
      );
  }
}
export function conditionalCanvasIssues(raw: ConditionalCanvas): ConditionalCanvasIssue[] {
  const parsed = ConditionalCanvasSchema.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map((i) => ({ message: i.message }));
  const draft = parsed.data;
  let shape: ReturnType<typeof layout>;
  try {
    shape = layout(draft);
  } catch (e) {
    return [{ message: e instanceof Error ? e.message : "Invalid conditional topology." }];
  }
  const issues: ConditionalCanvasIssue[] = [];
  try {
    NonnegativeStroopsSchema.parse(shape.root.config.minAmountStroops ?? "0");
    ConditionalConditionSchema.parse({
      nodeId: shape.condition.id,
      kind: shape.condition.config.kind,
      thresholdStroops:
        "amountStroops" in shape.condition.config
          ? shape.condition.config.amountStroops
          : undefined,
      thresholdMode: draft.conditionalPolicies.condition?.thresholdMode ?? "constant",
    });
  } catch {
    issues.push({
      message: "Receive minimum and threshold must be canonical bounded nonnegative stroops.",
    });
  }
  for (const node of draft.nodes)
    if (node.type === "pay" || node.type === "split")
      try {
        const n = payment(draft, node);
        financial(n);
        if (
          shape.prefix.some((p) => p.id === node.id) &&
          n.kind === "pay" &&
          (n.configuration.payoutValue.kind === "full" ||
            (n.configuration.payoutValue.kind === "percentage" &&
              n.configuration.payoutValue.bps === 10000))
        )
          throw new Error("An upstream Pay must leave a downstream budget.");
      } catch (e) {
        issues.push({
          nodeId: node.id,
          message: e instanceof Error ? e.message : "Invalid payment configuration.",
        });
      }
  return issues;
}
export function conditionalDefinitionFromCanvas(
  raw: ConditionalCanvas,
  options: { owner: string; assetContract: string },
): ConditionalDefinition {
  const draft = ConditionalCanvasSchema.parse(raw),
    issues = conditionalCanvasIssues(draft);
  if (issues.length) throw new Error(issues.map((i) => i.message).join(" "));
  const { root, condition, prefix, yes, no } = layout(draft);
  const terminal = (n: FlowNode) =>
    n.type === "return_to_owner"
      ? { kind: "return_to_owner" as const, nodeId: n.id }
      : payment(draft, n);
  return ConditionalDefinitionSchema.parse({
    version: 2,
    owner: options.owner,
    assetContract: options.assetContract,
    root: { nodeId: root.id, minAmountStroops: root.config.minAmountStroops ?? "0" },
    prefix: prefix.map((n) => payment(draft, n)),
    condition: {
      nodeId: condition.id,
      kind: condition.config.kind,
      thresholdStroops:
        "amountStroops" in condition.config ? condition.config.amountStroops : undefined,
      thresholdMode: draft.conditionalPolicies.condition?.thresholdMode ?? "constant",
    },
    trueBranch: terminal(yes),
    falseBranch: terminal(no),
  });
}
const valueText = (v: ConditionalPayNode["configuration"]["payoutValue"]) =>
  v.kind === "full"
    ? "the full incoming amount"
    : v.kind === "fixed"
      ? `${v.amountStroops} stroops`
      : `${v.bps}/10000 of incoming amount (rounded down)`;
function paymentText(n: ConditionalPayNode | ConditionalSplitNode): string {
  if (n.kind === "pay")
    return `Pay ${valueText(n.configuration.payoutValue)} to ${n.policy.recipient === "execution" ? "the payer-supplied recipient" : n.configuration.recipient} (recipient ${n.policy.recipient}; payout ${n.policy.payoutValue})`;
  const rows = n.configuration.configuredRows.map(
    (r, i) =>
      `${r.rowId}: ${r.allocation ? valueText(r.allocation) : "payer-supplied allocation"} to ${r.recipient ?? "payer-supplied recipient"} (recipient ${n.policy.rows[i]!.recipient}; allocation ${n.policy.rows[i]!.allocation})`,
  );
  rows.push(
    ...n.configuration.additionalRecipients.map(
      (r) => `${r.rowId}: ${valueText(r.allocation)} to ${r.recipient}`,
    ),
  );
  const execution =
    n.policy.additionalRecipients === "execution" ||
    n.policy.rows.some((row) => row.recipient === "execution" || row.allocation === "execution");
  const funding =
    n.policy.allocationMode === "percentage"
      ? "Shares total exactly 10000 bps; the last row receives the rounding remainder"
      : execution
        ? "Final fixed amounts must exactly equal this invocation's incoming funds; underfunding and excess are refused, with no old accumulation funding execution inputs"
        : "Stored fixed amounts retain accumulation until funded; accepted accumulation blocks configuration updates";
  return `Split (${n.policy.allocationMode}; additional recipients ${n.policy.additionalRecipients}): ${rows.join("; ") || "payer-supplied additional recipients"}. ${funding}`;
}
const rules =
  "Only declared prefix and selected-branch execution inputs are accepted; constants and stored mutable values cannot be overridden. Fixed Pay requires its full payout and underfunding fails atomically. Percentage Pay rounds down; upstream Pay forwards only its incoming budget minus payout and cannot skip a child on zero remainder. Terminal Pay refunds only this invocation's unused budget to the original payer. Whole-graph accounted obligations, including inactive-branch debt, block stored updates. Any bound revision change invalidates old payments before funding.";
export function conditionalDefinitionEnglish(raw: ConditionalDefinition): string {
  const d = ConditionalDefinitionSchema.parse(raw),
    terminal = (n: ConditionalDefinition["trueBranch"]) =>
      n.kind === "return_to_owner"
        ? `Return the full incoming amount to immutable deployment owner ${d.owner} (not a payer refund)`
        : paymentText(n);
  return `Receive at least ${d.root.minAmountStroops} stroops of ${d.assetContract}. ${d.prefix.map(paymentText).join("; ")}${d.prefix.length ? ". " : ""}Compare the amount remaining after upstream Pay deductions: strictly ${d.condition.kind === "amount_gt" ? "greater than" : "less than"} ${d.condition.thresholdStroops} stroops (threshold ${d.condition.thresholdMode}; never a per-payment input). Equality follows False. True: ${terminal(d.trueBranch)}. False: ${terminal(d.falseBranch)}. ${rules}`;
}
export function conditionalCanvasEnglish(
  raw: ConditionalCanvas,
  options?: { owner?: string },
): string {
  const draft = ConditionalCanvasSchema.parse(raw),
    issues = conditionalCanvasIssues(draft);
  if (issues.length)
    return `Conditional draft is incomplete: ${issues.map((i) => i.message).join(" ")}`;
  const { root, condition, prefix, yes, no } = layout(draft),
    terminal = (n: FlowNode) =>
      n.type === "return_to_owner"
        ? `Return the full incoming amount to ${options?.owner ? `immutable deployment owner ${options.owner}` : "the deploying owner wallet (full address resolved and reviewed before signing)"} (not a payer refund)`
        : paymentText(payment(draft, n));
  return `Receive at least ${root.config.minAmountStroops ?? "0"} stroops of ${assetLabel(root.config.asset)}. ${prefix.map((n) => paymentText(payment(draft, n))).join("; ")}${prefix.length ? ". " : ""}Compare the amount remaining after upstream Pay deductions: strictly ${condition.config.kind === "amount_gt" ? "greater than" : "less than"} ${"amountStroops" in condition.config ? condition.config.amountStroops : ""} stroops (threshold ${draft.conditionalPolicies.condition?.thresholdMode ?? "constant"}; never a per-payment input). Equality follows False. True: ${terminal(yes)}. False: ${terminal(no)}. ${rules}`;
}
export function conditionalArtifactAvailability(
  draft: ConditionalCanvas,
  hashes: Partial<Record<TemplateKind, string>>,
): { available: boolean; reason?: string } {
  const issues = conditionalCanvasIssues(draft);
  if (issues.length) return { available: false, reason: issues[0]!.message };
  try {
    for (const n of draft.nodes) {
      const kind =
          n.type === "on_receive"
            ? "DEPOSIT_TRIGGER"
            : n.type === "condition"
              ? "ROUTER"
              : n.type === "split"
                ? "SPLITTER"
                : "PAYER",
        hash = hashes[kind];
      if (!hash) throw new Error(`No compatible ${kind} artifact is configured.`);
      assertConditionalArtifact(kind, hash);
    }
    return { available: true };
  } catch (e) {
    return {
      available: false,
      reason: e instanceof Error ? e.message : "Compatible conditional artifacts are unavailable.",
    };
  }
}
