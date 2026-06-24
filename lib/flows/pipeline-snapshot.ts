import { AppError } from "@/lib/errors";
import type { TemplateKind } from "@prisma/client";

export type PipelineSnapshotNode = {
  nodeId: string;
  contractAddress: string;
  templateKind: string;
  salt?: unknown;
};

/**
 * Locate a deployed pipeline node by template kind (and optionally nodeId) in a
 * deployment's `pipelineSnapshot`. Used by the dev-mode mutation API to find the
 * on-chain contract address to mutate.
 */
export function findPipelineNode(
  snapshot: unknown,
  templateKind: TemplateKind,
  nodeId?: string,
): PipelineSnapshotNode {
  const nodes = (snapshot as PipelineSnapshotNode[] | null) ?? [];
  const matches = nodes.filter(
    (n) => n.templateKind === templateKind && (!nodeId || n.nodeId === nodeId),
  );
  if (matches.length === 0) {
    throw new AppError(
      "VALIDATION",
      nodeId
        ? `No ${templateKind} node "${nodeId}" found in this deployment. Is dev mode on and deployed?`
        : `No ${templateKind} node found in this deployment. Is dev mode on and deployed?`,
    );
  }
  if (matches.length > 1) {
    throw new AppError(
      "VALIDATION",
      `Multiple ${templateKind} nodes found; pass "nodeId" to choose one (${matches
        .map((n) => n.nodeId)
        .join(", ")}).`,
    );
  }
  const node = matches[0]!;
  if (!node.contractAddress) {
    throw new AppError("VALIDATION", `${templateKind} node has no contract address yet`);
  }
  return node;
}
