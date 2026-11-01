import type { NodeFieldPolicy, FlowFieldPolicies } from "@/lib/flows/field-policies";
import { executionPath, hasMutablePolicies } from "@/lib/flows/execution-v1";
import type { FlowGraph, FlowNode } from "@/lib/flows/schema";
import { assertExecutionArtifact, assertMutationArtifact } from "@/lib/stellar/execution-artifacts";
import { editBuilderNodes, type BuilderDraft } from "./graph-state.utils";

export type ExecutionArtifacts = {
  receive: boolean;
  pay: boolean;
  split: boolean;
  mutation?: { receive: boolean; pay: boolean; split: boolean };
};

/** Readiness comes from the environment's resolved hashes, never a client flag
 * or the existence of source code for the new ABI. */
export function executionArtifactsFromHashes(
  hashes: ReadonlyMap<string, string>,
): ExecutionArtifacts {
  const supports = (kind: string, mutation = false) => {
    const hash = hashes.get(kind);
    if (!hash) return false;
    try {
      assertExecutionArtifact(kind, hash);
      if (mutation) assertMutationArtifact(kind, hash);
      return true;
    } catch {
      return false;
    }
  };
  const mutation = {
    receive: supports("DEPOSIT_TRIGGER", true),
    pay: supports("PAYER", true),
    split: supports("SPLITTER", true),
  };
  return {
    receive: supports("DEPOSIT_TRIGGER"),
    pay: supports("PAYER"),
    split: supports("SPLITTER"),
    ...(Object.values(mutation).some(Boolean) ? { mutation } : {}),
  };
}

export function executionDeploymentAvailable(
  graph: FlowGraph,
  artifacts?: ExecutionArtifacts,
): boolean {
  if (graph.fieldPolicies === undefined) return true;
  const selected = hasMutablePolicies(graph) ? artifacts?.mutation : artifacts;
  return Boolean(
    selected?.receive &&
    graph.nodes.every(
      (node) =>
        node.type === "on_receive" ||
        (node.type === "pay" && selected.pay) ||
        (node.type === "split" && selected.split),
    ),
  );
}

/** The controls describe the same narrow path as the compiler, including drafts
 * with unset recipient/amount fields that will be supplied at payment time. */
export function executionEditingIssue(graph: FlowGraph): string | undefined {
  try {
    executionPath({ ...graph, fieldPolicies: graph.fieldPolicies ?? { version: 1, nodes: [] } });
    return undefined;
  } catch {
    return "Execution inputs need one On Receive path through Pay blocks, ending in Pay or Split.";
  }
}

export function builderNodePolicy(
  node: FlowNode,
  policies?: FlowFieldPolicies,
): NodeFieldPolicy | undefined {
  const existing = policies?.nodes.find(
    (policy) => policy.nodeId === node.id && policy.kind === node.type,
  );
  if (existing) return existing;
  if (node.type === "pay")
    return { nodeId: node.id, kind: "pay", recipient: "constant", payoutValue: "constant" };
  if (node.type !== "split") return undefined;
  const used = new Set(node.config.recipients.flatMap((row) => (row.rowId ? [row.rowId] : [])));
  let index = 1;
  return {
    nodeId: node.id,
    kind: "split",
    allocationMode: node.config.recipients[0]?.mode ?? "percentage",
    additionalRecipients: "constant",
    rows: node.config.recipients.map((row) => {
      while (used.has(`row-${index}`)) index++;
      const rowId = row.rowId ?? `row-${index++}`;
      used.add(rowId);
      return { rowId, recipient: "constant", allocation: "constant" };
    }),
  };
}

/** Declaration and row identity are one draft update so autosave can never
 * observe an execution policy with missing/mismatched configured row IDs. */
export function updateBuilderPolicy(draft: BuilderDraft, policy: NodeFieldPolicy): BuilderDraft {
  const node = draft.nodes.find(
    (candidate) => candidate.id === policy.nodeId && candidate.type === policy.kind,
  );
  if (!node) return draft;
  const nodes = draft.nodes.map((candidate) =>
    candidate.id === node.id && candidate.type === "split" && policy.kind === "split"
      ? {
          ...candidate,
          config: {
            ...candidate.config,
            recipients: candidate.config.recipients.map((row, index) => ({
              ...row,
              rowId: policy.rows[index]?.rowId ?? row.rowId,
            })),
          },
        }
      : candidate,
  );
  const policies = draft.fieldPolicies?.nodes ?? [];
  return editBuilderNodes(
    {
      nodes,
      fieldPolicies: {
        version: 1,
        nodes: [...policies.filter((p) => p.nodeId !== policy.nodeId), policy],
      },
    },
    nodes,
  );
}

export const EXECUTION_ARTIFACTS_UNAVAILABLE =
  "Execution input drafts can be saved, but this environment is not ready to deploy this flow with execution inputs.";
