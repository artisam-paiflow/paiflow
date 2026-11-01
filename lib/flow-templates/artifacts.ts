import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { FlowGraph } from "@/lib/flows/schema";
import { flowToPipeline } from "@/lib/flows/to-params";
import { assertExecutionArtifact, assertMutationArtifact } from "@/lib/stellar/execution-artifacts";
import { hasMutablePolicies } from "@/lib/flows/execution-v1";
import { TemplateArtifactsSchema, type TemplateArtifacts } from "./schema";

/** Stable JSON digest for immutable publication evidence (not signatures). */
export function contentHash(value: unknown): string {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object")
      return `{${Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
        .join(",")}}`;
    return JSON.stringify(value) ?? "null";
  };
  return createHash("sha256").update(canonical(value)).digest("hex");
}
/** Publication requires synchronized DB artifact evidence; it never uploads or activates anything. */
export async function pinTemplateArtifacts(
  graph: FlowGraph,
  network: string,
  tx: Prisma.TransactionClient = db,
): Promise<TemplateArtifacts> {
  if (network !== env().STELLAR_NETWORK)
    throw new AppError("CONFLICT", "Template network differs from this environment");
  const pipeline = flowToPipeline(graph, undefined, { forValidation: true });
  const [factory, rows] = await Promise.all([
    tx.factoryDeployment.findUnique({ where: { network } }),
    tx.contractTemplate.findMany({
      where: { network, kind: { in: pipeline.map((node) => node.templateKind) } },
    }),
  ]);
  if (!factory?.wasmHash)
    throw new AppError(
      "CONFLICT",
      "Factory address and WASM evidence must be synchronized before publication",
    );
  return TemplateArtifactsSchema.parse({
    version: 1,
    compilerAbi: 1,
    factoryAddress: factory.address,
    factoryWasmHash: factory.wasmHash,
    nodes: pipeline.map((node) => {
      const artifact = rows.find((row) => row.kind === node.templateKind);
      if (!artifact)
        throw new AppError(
          "CONFLICT",
          `No synchronized ${node.templateKind} artifact for publication`,
        );
      if (graph.fieldPolicies) {
        try {
          assertExecutionArtifact(node.templateKind, artifact.wasmHash);
          if (hasMutablePolicies(graph))
            assertMutationArtifact(node.templateKind, artifact.wasmHash);
        } catch {
          throw new AppError(
            "CONFLICT",
            "Configured artifacts do not enforce this template's policies",
          );
        }
      }
      return {
        nodeId: node.nodeId,
        templateKind: node.templateKind,
        wasmHash: artifact.wasmHash,
        abiHash: contentHash(artifact.abiJson),
        policyVersion: graph.fieldPolicies ? 1 : 0,
      };
    }),
  });
}
/** New preparations fail closed after registry/ABI cutover, never silently repin.
 * Already-prepared intents retain their original evidence and ordinary expiry. */
export async function assertPinnedTemplateArtifacts(
  graph: FlowGraph,
  network: string,
  rawArtifacts: unknown,
  tx: Prisma.TransactionClient = db,
) {
  const artifacts = TemplateArtifactsSchema.parse(rawArtifacts);
  const current = await pinTemplateArtifacts(graph, network, tx);
  if (contentHash(current) !== contentHash(artifacts))
    throw new AppError(
      "CONFLICT",
      "Pinned template artifacts are unavailable or incompatible; publish a new version",
    );
  return artifacts;
}
