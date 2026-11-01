import "server-only";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { AppError } from "@/lib/errors";
import { getOwnedInstance, instanceState } from "./service";
import { InstanceSnapshotSchema } from "./schema";
import { InstanceCompiledTermsSchema } from "./compiled-review-schema";
import { preparedInstanceTerms } from "@/lib/stellar/instance-review";

/** Initial admission evidence only; never describe it as current mutable configuration. */
export async function instanceInitialReview(
  ownerId: string,
  templateId: string,
  instanceId: string,
) {
  const row = await getOwnedInstance(ownerId, templateId, instanceId);
  const snapshot = InstanceSnapshotSchema.parse(row.instanceSnapshot);
  if (snapshot.templateId !== templateId)
    throw new AppError("CONFLICT", "Instance admission template identity is inconsistent");
  const compiledTerms = InstanceCompiledTermsSchema.parse(row.paramsSnapshot);
  if (
    compiledTerms.length !== snapshot.artifacts.nodes.length ||
    compiledTerms.some(
      (n, i) =>
        n.nodeId !== snapshot.artifacts.nodes[i]?.nodeId ||
        n.templateKind !== snapshot.artifacts.nodes[i]?.templateKind,
    )
  )
    throw new AppError(
      "CONFLICT",
      "Compiled initial terms differ from the pinned instance artifacts",
    );
  const graph = FlowGraphSchema.parse(row.graphSnapshot);
  const preparedTerms = preparedInstanceTerms({
    unsignedXdr: row.unsignedXdr,
    preparedTxHash: row.preparedTxHash,
    pipelineSnapshot: row.pipelineSnapshot,
    snapshot,
    graph,
    compiledTerms,
  });
  return {
    receipt: instanceState(row),
    graph,
    bindings: snapshot.bindings,
    artifacts: snapshot.artifacts,
    contentHash: snapshot.contentHash,
    compiledTerms: preparedTerms,
  };
}
