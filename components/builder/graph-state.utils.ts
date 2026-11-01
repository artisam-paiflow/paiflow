import type { NodeFieldPolicy } from "@/lib/flows/field-policies";
import type { FlowGraph, FlowNode } from "@/lib/flows/schema";

export type BuilderDraft = Pick<FlowGraph, "nodes" | "fieldPolicies">;

/** Draft structural edits change the definition before deployment. Keep policy
 * identity/modes for surviving fields; new configured rows start constant. */
export function editBuilderNodes(draft: BuilderDraft, nextNodes: FlowNode[]): BuilderDraft {
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
  metadata: Pick<FlowGraph, "fieldPolicies" | "notify" | "positions">,
): FlowGraph {
  return {
    nodes,
    edges,
    ...(metadata.fieldPolicies !== undefined ? { fieldPolicies: metadata.fieldPolicies } : {}),
    notify: metadata.notify,
    positions: metadata.positions,
  };
}
