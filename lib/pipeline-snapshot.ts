import "server-only";
import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import type { PipelineImplementation } from "@/lib/flows/implementation";
import type { TemplateKind } from "@prisma/client";

export type PipelineSnapshotNode = {
  nodeId: string;
  contractAddress: string;
  templateKind: string;
  salt?: unknown;
  implementation?: PipelineImplementation;
};

/**
 * Locate a deployed pipeline node by template kind (and optionally nodeId) in a
 * deployment's `pipelineSnapshot`. Resolves the recorded on-chain contract address.
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
        ? `No ${templateKind} node "${nodeId}" found in this deployment.`
        : `No ${templateKind} node found in this deployment.`,
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

/** Every well-formed node of `templateKind` in a snapshot; a malformed entry is skipped. */
export function pipelineNodesOfKind(
  snapshot: unknown,
  templateKind: TemplateKind,
): PipelineSnapshotNode[] {
  if (!Array.isArray(snapshot)) return [];
  return snapshot.filter(
    (n): n is PipelineSnapshotNode =>
      typeof n === "object" &&
      n !== null &&
      (n as PipelineSnapshotNode).templateKind === templateKind &&
      typeof (n as PipelineSnapshotNode).nodeId === "string" &&
      typeof (n as PipelineSnapshotNode).contractAddress === "string" &&
      (n as PipelineSnapshotNode).contractAddress.length > 0,
  );
}

// Contract addresses always come from the deployment record, never the graph.
export const BalancePipelineSnapshotSchema = z
  .array(
    z.object({
      nodeId: z.string().min(1),
      templateKind: z.string().min(1),
      contractAddress: z.string().refine(StrKey.isValidContract),
    }),
  )
  .min(1)
  .max(128)
  .superRefine((nodes, ctx) => {
    if (
      new Set(nodes.map((n) => n.nodeId)).size !== nodes.length ||
      new Set(nodes.map((n) => n.contractAddress)).size !== nodes.length
    )
      ctx.addIssue({ code: "custom", message: "Ambiguous deployment pipeline" });
  });
