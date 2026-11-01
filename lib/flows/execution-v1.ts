import { StrKey } from "@stellar/stellar-sdk";
import { TemplateKind } from "@prisma/client";
import {
  PolicyIdSchema,
  REUSABLE_LIMITS,
  StroopsSchema,
  type NodeFieldPolicy,
} from "./field-policies";
import { directBinding } from "./implementation";
import { pctToBps, type FlowGraph, type FlowNode } from "./schema";
import type { CompiledPipelineNode } from "./to-params";

/** The complete, deliberately narrow v1 path. This never enables an artifact. */
export function executionPath(graph: FlowGraph): FlowNode[] {
  if (graph.fieldPolicies === undefined) throw new Error("An explicit field policy is required");
  const roots = graph.nodes.filter((n) => n.type === "on_receive");
  if (roots.length !== 1 || graph.nodes.length < 2)
    throw new Error("Execution requires one receive root and a payment action");
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const path: FlowNode[] = [];
  let node: FlowNode | undefined = roots[0];
  while (node) {
    if (!PolicyIdSchema.safeParse(node.id).success || path.some((n) => n.id === node!.id))
      throw new Error("Invalid or cyclic execution path");
    path.push(node);
    if (!["on_receive", "pay", "split"].includes(node.type))
      throw new Error("This block cannot forward immediate execution inputs");
    const outgoing = graph.edges.filter((e) => e.source === node!.id);
    const incoming = graph.edges.filter((e) => e.target === node!.id);
    if (
      incoming.length !== (path.length === 1 ? 0 : 1) ||
      outgoing.length > 1 ||
      (node.type === "split" && outgoing.length)
    )
      throw new Error("Execution v1 requires a single path ending in Pay or Split");
    if (outgoing.some((e) => e.sourceHandle !== undefined && e.sourceHandle !== "true"))
      throw new Error("Execution paths cannot branch");
    node = outgoing[0] ? nodes.get(outgoing[0].target) : undefined;
    if (outgoing.length && !node) throw new Error("Execution edge has a missing target");
  }
  if (path.length !== graph.nodes.length || graph.edges.length !== path.length - 1)
    throw new Error("Every execution node must belong to the complete path");
  if (path.at(-1)?.type === "on_receive") throw new Error("Execution requires a terminal action");
  return path;
}
export function executionPolicy(graph: FlowGraph, node: FlowNode): NodeFieldPolicy | undefined {
  const declared = graph.fieldPolicies?.nodes.find((p) => p.nodeId === node.id);
  if (declared) return declared;
  if (node.type === "pay")
    return { kind: "pay", nodeId: node.id, recipient: "constant", payoutValue: "constant" };
  if (node.type === "split")
    return {
      kind: "split",
      nodeId: node.id,
      allocationMode: node.config.recipients[0]?.mode ?? "percentage",
      additionalRecipients: "constant",
      rows: node.config.recipients.map((row, i) => ({
        rowId: row.rowId ?? `row-${i + 1}`,
        recipient: "constant",
        allocation: "constant",
      })),
    };
  return undefined;
}
const nonnegative = (value: string) => {
  if (
    !/^(0|[1-9]\d*)$/.test(value) ||
    value.length > 39 ||
    BigInt(value) > BigInt(REUSABLE_LIMITS.maxStroops)
  )
    throw new Error("Invalid minimum amount");
};
/** Compile source intent only. Deployment separately verifies the exact WASM hash. */
export function compileExecutionPipeline(graph: FlowGraph): CompiledPipelineNode[] {
  const path = executionPath(graph);
  const root = path[0];
  if (root?.type !== "on_receive") throw new Error("Execution requires a receive root");
  const asset = root.config.asset;
  nonnegative(root.config.minAmountStroops ?? "0");
  return path.map((node, index): CompiledPipelineNode => {
    const policy = executionPolicy(graph, node);
    const nextStepNodeIds = path[index + 1] ? [path[index + 1]!.id] : [];
    const common = {
      nodeId: node.id,
      implementation: { version: 1 as const, bindings: [directBinding(node)] },
    };
    if (node.type === "on_receive")
      return {
        ...common,
        templateKind: TemplateKind.DEPOSIT_TRIGGER,
        params: {
          kind: "deposit_trigger",
          asset,
          nextStepNodeIds,
          executionNodeId: node.id,
          minAmountStroops: node.config.minAmountStroops ?? "0",
        },
      };
    if ((node.type !== "pay" && node.type !== "split") || !policy)
      throw new Error("Unsupported execution action");
    if (JSON.stringify(node.config.asset) !== JSON.stringify(asset))
      throw new Error("Every execution node must use the root asset");
    if (node.type === "pay" && policy.kind === "pay") {
      if (policy.recipient === "mutable" || policy.payoutValue !== "constant")
        throw new Error("Mutable policies are not implemented");
      if (policy.recipient === "constant" && !StrKey.isValidEd25519PublicKey(node.config.recipient))
        throw new Error("Invalid constant Pay recipient");
      const percentageBps = node.config.fullAmount
        ? 10_000
        : node.config.mode === "percentage"
          ? pctToBps(node.config.percentage ?? 0)
          : 0;
      const amountStroops =
        percentageBps > 0 ? "0" : StroopsSchema.parse(node.config.amountStroops);
      if (node.config.mode === "percentage" && percentageBps <= 0)
        throw new Error("Invalid Pay percentage");
      if (nextStepNodeIds.length && percentageBps === 10_000)
        throw new Error("A full payout cannot forward funds to another execution node");
      return {
        ...common,
        templateKind: TemplateKind.PAYER,
        params: {
          kind: "payer",
          asset,
          recipient: node.config.recipient,
          amountStroops,
          percentageBps,
          mode: percentageBps > 0 ? "percentage" : "fixed",
          fullAmount: node.config.fullAmount,
          fieldPolicy: policy,
          nextStepNodeIds,
        },
      };
    }
    if (node.type !== "split" || policy.kind !== "split")
      throw new Error("Policy does not match execution node");
    if (
      policy.additionalRecipients === "mutable" ||
      policy.rows.some((r) => r.recipient === "mutable" || r.allocation === "mutable")
    )
      throw new Error("Mutable policies are not implemented");
    if (policy.rows.length !== node.config.recipients.length)
      throw new Error("Configured Split policy rows must match");
    let constantBps = 0;
    let variableAllocations = 0;
    const addresses = new Set<string>();
    const ids = new Set<string>();
    const recipients = node.config.recipients.map((row, i) => {
      const declared = policy.rows[i]!;
      if (
        !PolicyIdSchema.safeParse(declared.rowId).success ||
        ids.has(declared.rowId) ||
        row.mode !== policy.allocationMode
      )
        throw new Error("Invalid configured Split row identity or mode");
      ids.add(declared.rowId);
      if (declared.recipient === "constant") {
        if (!StrKey.isValidEd25519PublicKey(row.address) || addresses.has(row.address))
          throw new Error("Invalid or duplicate constant Split recipient");
        addresses.add(row.address);
      }
      if (declared.allocation === "execution") variableAllocations++;
      else if (row.mode === "percentage") {
        if (!Number.isInteger(row.bps) || row.bps <= 0 || row.bps > 10_000)
          throw new Error("Invalid constant Split allocation");
        constantBps += row.bps;
      } else StroopsSchema.parse(row.amountStroops);
      return {
        rowId: declared.rowId,
        address: row.address,
        bps: row.mode === "percentage" ? row.bps : 0,
        amount: row.mode === "fixed" ? row.amountStroops : "0",
      };
    });
    if (
      (!recipients.length && policy.additionalRecipients !== "execution") ||
      recipients.length > 20
    )
      throw new Error("Invalid Split recipient count");
    if (
      policy.allocationMode === "percentage" &&
      (constantBps + variableAllocations > 10_000 ||
        (!variableAllocations &&
          policy.additionalRecipients === "constant" &&
          constantBps !== 10_000))
    )
      throw new Error("Invalid Split percentage total");
    return {
      ...common,
      templateKind: TemplateKind.SPLITTER,
      params: {
        kind: "splitter",
        asset,
        recipients,
        minAmountStroops: "0",
        fieldPolicy: policy,
        nextStepNodeIds,
      },
    };
  });
}
