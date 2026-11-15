import { z } from "zod";
import {
  ConditionalDefinitionSchema,
  conditionalBindingsSchema,
  type ConditionalBinding,
  type ConditionalDefinition,
} from "@/lib/flows/conditional-v2";
import {
  ConditionalCurrentConfigurationSchema,
  ConditionalNodeStateSchema,
  type ConditionalNodeState,
} from "@/lib/flows/conditional-v2-state";
import {
  ContractAddressSchema,
  REUSABLE_LIMITS,
  WalletAddressSchema,
} from "@/lib/flows/field-policies";
import {
  PipelineImplementationSchema,
  type PipelineImplementation,
} from "@/lib/flows/implementation";

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const ManifestShape = z
  .object({
    version: z.literal(2),
    rootContract: ContractAddressSchema,
    admin: WalletAddressSchema,
    assetContract: ContractAddressSchema,
    nodes: z
      .array(z.object({ wasmHash: HashSchema, state: ConditionalNodeStateSchema }).strict())
      .min(4)
      .max(REUSABLE_LIMITS.nodes),
  })
  .strict();
type ManifestShape = z.infer<typeof ManifestShape>;
function manifestDefinition(manifest: ManifestShape): ConditionalDefinition {
  const states = manifest.nodes.map((node) => node.state);
  const root = states[0]!;
  const condition = states.at(-3)!;
  const yes = states.at(-2)!;
  const no = states.at(-1)!;
  if (root.configuration.kind !== "receive" || condition.configuration.kind !== "condition")
    throw new Error("Manifest requires Receive, prefix, condition, True, False order");
  const terminal = (state: ConditionalNodeState) => {
    const configuration = state.configuration;
    if (configuration.kind === "return_to_owner")
      return { kind: "return_to_owner" as const, nodeId: state.nodeId };
    if (configuration.kind !== "pay" && configuration.kind !== "split")
      throw new Error("Manifest branch must terminate in Pay, Split or owner return");
    return configuration;
  };
  const prefix = states.slice(1, -3).map((state) => {
    if (state.configuration.kind !== "pay")
      throw new Error("Manifest prefix contains an unsupported step");
    return state.configuration;
  });
  return ConditionalDefinitionSchema.parse({
    version: 2,
    owner: manifest.admin,
    assetContract: manifest.assetContract,
    root: { nodeId: root.nodeId, minAmountStroops: root.configuration.minAmountStroops },
    prefix,
    condition: {
      nodeId: condition.nodeId,
      kind: condition.configuration.comparison,
      thresholdStroops: condition.configuration.thresholdStroops,
      thresholdMode: condition.configuration.thresholdMode,
    },
    trueBranch: terminal(yes),
    falseBranch: terminal(no),
  });
}
/** Complete immutable initial manifest. Its pins are declarations to compare,
 * never a trusted artifact registry or proof of executable provenance. */
export const ConditionalGraphManifestSchema = ManifestShape.superRefine((manifest, ctx) => {
  if (manifest.nodes.some((node) => !ConditionalNodeStateSchema.safeParse(node.state).success))
    return;
  try {
    const definition = manifestDefinition(manifest);
    const root = manifest.nodes[0]!.state;
    if (
      root.contractAddress !== manifest.rootContract ||
      manifest.nodes.some((node) => node.state.revision !== "0")
    )
      throw new Error("Initial manifest must bind its root and revision-zero states");
    const result = ConditionalCurrentConfigurationSchema.safeParse({
      version: 2,
      confirmedLedger: 1,
      definition,
      nodes: manifest.nodes.map((node) => ({
        nodeId: node.state.nodeId,
        contractAddress: node.state.contractAddress,
        expectedRevision: node.state.revision,
        wasmHash: node.wasmHash,
      })),
      statuses: manifest.nodes.map((node) => ({ state: node.state, obligationsStroops: "0" })),
    });
    if (!result.success)
      for (const issue of result.error.issues)
        ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  } catch (error) {
    if (error instanceof z.ZodError)
      for (const issue of error.issues)
        ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
    else if (error instanceof Error) ctx.addIssue({ code: "custom", message: error.message });
    else throw error;
  }
});
export type ConditionalGraphManifest = z.infer<typeof ConditionalGraphManifestSchema>;
export type ConditionalCompiledNode = {
  version: 2;
  nodeId: string;
  templateKind: "DEPOSIT_TRIGGER" | "PAYER" | "SPLITTER" | "ROUTER";
  implementation: PipelineImplementation;
  initialState: ConditionalNodeState;
};
export type ConditionalCompiledPipeline = {
  definition: ConditionalDefinition;
  bindings: ConditionalBinding[];
  manifest: ConditionalGraphManifest;
  nodes: ConditionalCompiledNode[];
};
/** Compile only the explicit normalized definition. This separate return type
 * cannot be passed to the retained v1 deployment constructor union. */
export function compileConditionalPipeline(
  raw: ConditionalDefinition,
  rawBindings: ConditionalBinding[],
): ConditionalCompiledPipeline {
  const definition = ConditionalDefinitionSchema.parse(raw);
  const bindings = conditionalBindingsSchema(definition).parse(rawBindings);
  if (bindings.some((binding) => binding.expectedRevision !== "0"))
    throw new Error("Conditional construction requires revision-zero bindings");
  const conditionIndex = definition.prefix.length + 1;
  const terminal = (node: ConditionalDefinition["trueBranch"]) =>
    node.kind === "return_to_owner"
      ? { kind: "return_to_owner" as const, recipient: definition.owner }
      : node;
  const configurations: ConditionalNodeState["configuration"][] = [
    { kind: "receive", minAmountStroops: definition.root.minAmountStroops },
    ...definition.prefix,
    {
      kind: "condition",
      comparison: definition.condition.kind,
      thresholdStroops: definition.condition.thresholdStroops,
      thresholdMode: definition.condition.thresholdMode,
    },
    terminal(definition.trueBranch),
    terminal(definition.falseBranch),
  ];
  const nodes = bindings.map((binding, index): ConditionalCompiledNode => {
    const configuration = configurations[index]!;
    const initialState = ConditionalNodeStateSchema.parse({
      version: 2,
      nodeId: binding.nodeId,
      contractAddress: binding.contractAddress,
      revision: "0",
      admin: definition.owner,
      assetContract: definition.assetContract,
      parentContract:
        index === 0
          ? null
          : bindings[index > conditionIndex ? conditionIndex : index - 1]!.contractAddress,
      nextContracts:
        index === conditionIndex
          ? bindings.slice(index + 1).map((node) => node.contractAddress)
          : index < conditionIndex
            ? [bindings[index + 1]!.contractAddress]
            : [],
      configuration,
    });
    const semanticKind = configuration.kind === "receive" ? "on_receive" : configuration.kind;
    return {
      version: 2,
      nodeId: binding.nodeId,
      templateKind:
        configuration.kind === "receive"
          ? "DEPOSIT_TRIGGER"
          : configuration.kind === "condition"
            ? "ROUTER"
            : configuration.kind === "split"
              ? "SPLITTER"
              : "PAYER",
      implementation: PipelineImplementationSchema.parse({
        version: 1,
        bindings: [
          {
            blockId: binding.nodeId,
            blockType: semanticKind,
            role:
              semanticKind === "on_receive"
                ? "trigger"
                : semanticKind === "condition"
                  ? "condition"
                  : "action",
          },
        ],
      }),
      initialState,
    };
  });
  const manifest = ConditionalGraphManifestSchema.parse({
    version: 2,
    rootContract: bindings[0]!.contractAddress,
    admin: definition.owner,
    assetContract: definition.assetContract,
    nodes: nodes.map((node, index) => ({
      wasmHash: bindings[index]!.wasmHash,
      state: node.initialState,
    })),
  });
  return { definition, bindings, manifest, nodes };
}
