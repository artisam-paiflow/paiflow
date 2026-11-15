import type { NodeFieldPolicy } from "@/lib/flows/field-policies";
import type { FlowGraph, FlowNode } from "@/lib/flows/schema";

import type { ConditionalCanvas } from "@/lib/flows/conditional-canvas-schema";
import { isConditionalCanvas, type OrdinaryFlowGraph } from "@/lib/flows/ordinary-schema";
type LegacyBuilderDraft = Pick<FlowGraph, "nodes" | "fieldPolicies">;
export type ConditionalBuilderDraft = Pick<
  ConditionalCanvas,
  "nodes" | "generation" | "conditionalPolicies" | "fieldPolicies"
>;
export type BuilderDraft = LegacyBuilderDraft | ConditionalBuilderDraft;
export function builderDraft(graph: OrdinaryFlowGraph): BuilderDraft {
  return isConditionalCanvas(graph)
    ? {
        nodes: graph.nodes,
        generation: graph.generation,
        conditionalPolicies: graph.conditionalPolicies,
      }
    : { nodes: graph.nodes, fieldPolicies: graph.fieldPolicies };
}
export function editBuilderNodes(draft: BuilderDraft, nextNodes: FlowNode[]): BuilderDraft {
  if (!("generation" in draft)) return editLegacyBuilderNodes(draft, nextNodes);
  const declared = draft.conditionalPolicies.nodes;
  const policies: NodeFieldPolicy[] = nextNodes.flatMap<NodeFieldPolicy>((node) => {
    const existing = declared.find((p) => p.nodeId === node.id && p.kind === node.type);
    if (existing) return [existing];
    if (node.type === "pay")
      return [{ kind: "pay", nodeId: node.id, recipient: "constant", payoutValue: "constant" }];
    if (node.type !== "split") return [];
    return [
      {
        kind: "split",
        nodeId: node.id,
        allocationMode: node.config.recipients[0]?.mode ?? "percentage",
        additionalRecipients: "constant",
        rows: [],
      },
    ];
  });
  const edited = editLegacyBuilderNodes(
    { nodes: draft.nodes, fieldPolicies: { version: 1, nodes: policies } },
    nextNodes,
  );
  const condition = draft.conditionalPolicies.condition;
  return {
    nodes: edited.nodes,
    generation: "conditional-v2",
    conditionalPolicies: {
      version: 2,
      nodes: edited.fieldPolicies!.nodes,
      ...(condition && nextNodes.some((n) => n.id === condition.nodeId && n.type === "condition")
        ? { condition }
        : {}),
    },
  };
}
/** Explicit user action only; never infer this generation from an old condition. */
export function enableConditionalDraft(draft: BuilderDraft): ConditionalBuilderDraft {
  if ("generation" in draft) return draft;
  if (
    draft.nodes.some(
      (n) =>
        !["on_receive", "pay", "split", "condition", "return_to_owner"].includes(n.type) ||
        (n.type === "condition" && n.config.kind !== "amount_gt" && n.config.kind !== "amount_lt"),
    )
  )
    throw new Error(
      "Conditional reusable flows support Receive, Pay, Split, amount conditions and Return to owner only. Remove other blocks before opting in.",
    );
  return editBuilderNodes(
    {
      generation: "conditional-v2",
      nodes: draft.nodes,
      conditionalPolicies: { version: 2, nodes: draft.fieldPolicies?.nodes ?? [] },
    },
    draft.nodes,
  ) as ConditionalBuilderDraft;
}
export function updateConditionalThresholdMode(
  draft: BuilderDraft,
  nodeId: string,
  thresholdMode: "constant" | "mutable",
): BuilderDraft {
  if (
    !("generation" in draft) ||
    !draft.nodes.some((n) => n.id === nodeId && n.type === "condition")
  )
    return draft;
  return {
    ...draft,
    conditionalPolicies: { ...draft.conditionalPolicies, condition: { nodeId, thresholdMode } },
  };
}

/** Draft structural edits change the definition before deployment. Keep policy
 * identity/modes for surviving fields; new configured rows start constant. */
function editLegacyBuilderNodes(
  draft: LegacyBuilderDraft,
  nextNodes: FlowNode[],
): LegacyBuilderDraft {
  const policies = draft.fieldPolicies;
  if (policies === undefined) return { nodes: nextNodes };
  const nodes = nextNodes.map((node) => {
    const policy = policies.nodes.find((p) => p.nodeId === node.id && p.kind === node.type);
    if (node.type !== "split" || policy?.kind !== "split") return node;
    // Reserve old IDs too: a newly added row must not inherit the deleted row's modes.
    const used = new Set([
      ...policy.rows.map((r) => r.rowId),
      ...node.config.recipients.flatMap((r) => (r.rowId ? [r.rowId] : [])),
    ]);
    let counter = 1;
    const recipients = node.config.recipients.map((row) => {
      if (row.rowId !== undefined) return row;
      while (used.has(`draft_row_${counter}`)) counter++;
      const rowId = `draft_row_${counter++}`;
      used.add(rowId);
      return { ...row, rowId };
    });
    return { ...node, config: { ...node.config, recipients } };
  });
  return {
    nodes,
    fieldPolicies: {
      ...policies,
      nodes: policies.nodes.flatMap<NodeFieldPolicy>((policy) => {
        const node = nodes.find((n) => n.id === policy.nodeId && n.type === policy.kind);
        // Deleting/replacing a node deletes only that node's draft policy.
        if (!node) return [];
        if (policy.kind === "pay" && node.type === "pay")
          return [
            {
              ...policy,
              payoutValue: node.config.fullAmount ? ("constant" as const) : policy.payoutValue,
            },
          ];
        if (policy.kind === "split" && node.type === "split")
          return [
            {
              ...policy,
              allocationMode: node.config.recipients[0]?.mode ?? policy.allocationMode,
              rows: node.config.recipients.map(
                (row) =>
                  policy.rows.find((r) => r.rowId === row.rowId) ?? {
                    rowId: row.rowId!,
                    recipient: "constant" as const,
                    allocation: "constant" as const,
                  },
              ),
            },
          ];
        return [];
      }),
    },
  };
}

/** Shared by keyboard removal and the settings panel Delete action. */
export function removeBuilderNodes(draft: BuilderDraft, ids: ReadonlySet<string>): BuilderDraft {
  return editBuilderNodes(
    draft,
    draft.nodes.filter((node) => !ids.has(node.id)),
  );
}

/** Rebuild the edited graph without dropping deployment-policy metadata. */
export function builderGraph(
  nodes: FlowGraph["nodes"],
  edges: FlowGraph["edges"],
  metadata: (Omit<LegacyBuilderDraft, "nodes"> | Omit<ConditionalBuilderDraft, "nodes">) &
    Pick<FlowGraph, "notify" | "positions">,
): OrdinaryFlowGraph {
  if ("generation" in metadata)
    return {
      nodes,
      edges,
      generation: "conditional-v2",
      conditionalPolicies: metadata.conditionalPolicies,
      notify: metadata.notify,
      positions: metadata.positions,
    };
  return {
    nodes,
    edges,
    ...(metadata.fieldPolicies !== undefined ? { fieldPolicies: metadata.fieldPolicies } : {}),
    notify: metadata.notify,
    positions: metadata.positions,
  };
}
