import type { Deployment } from "@prisma/client";
import { ConditionalDeploymentEnvelopeSchema } from "@/lib/flows/conditional-deployment";
import {
  CONDITIONAL_V2_WASM_HASHES,
  conditionalArtifactMetadata,
} from "@/lib/stellar/conditional-artifacts";
import {
  conditionalAcceptanceDefinition,
  conditionalAcceptancePlan,
} from "./conditional-v2-acceptance";
import { conditionalMutationDefinition } from "./conditional-v2-mutation-acceptance";

/** Correct explicit original evidence only; no deployment or artifact activation. */
export function conditionalDeploymentFixture(mutable = false) {
  const definition = mutable ? conditionalMutationDefinition() : conditionalAcceptanceDefinition();
  const plan = conditionalAcceptancePlan(definition, CONDITIONAL_V2_WASM_HASHES);
  const paramsSnapshot = ConditionalDeploymentEnvelopeSchema.parse({
    version: 2,
    generation: "conditional-v2",
    definition: plan.definition,
    manifest: plan.manifest,
    nodes: plan.nodes,
  });
  const pipelineSnapshot = plan.nodes.map((node, index) => ({
    nodeId: node.nodeId,
    contractAddress: node.initialState.contractAddress,
    templateKind: node.templateKind,
    implementation: node.implementation,
    salt: Buffer.alloc(32, index + 101).toString("hex"),
    wasmHash: plan.bindings[index]!.wasmHash,
    artifactCapabilities: conditionalArtifactMetadata(
      node.templateKind,
      plan.bindings[index]!.wasmHash,
    ),
  }));
  const deployment = {
    id: "12251225-1225-4225-8225-122512251225",
    status: "CONFIRMED",
    network: "testnet",
    sourceAccount: definition.owner,
    graphSnapshot: { privateAuthoringMetadata: { email: "private@example.invalid" } },
    paramsSnapshot,
    pipelineSnapshot,
  } as unknown as Deployment;
  return { deployment, plan, paramsSnapshot, pipelineSnapshot };
}
