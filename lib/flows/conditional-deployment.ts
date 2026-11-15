import { z } from "zod";
import {
  ConditionalDefinitionSchema,
  type ConditionalDefinition,
} from "@/lib/flows/conditional-v2";
import {
  ConditionalGraphManifestSchema,
  compileConditionalPipeline,
} from "@/lib/flows/conditional-v2-compiler";
import { ConditionalNodeStateSchema } from "@/lib/flows/conditional-v2-state";
import { PolicyIdSchema, REUSABLE_LIMITS } from "@/lib/flows/field-policies";
import { PipelineImplementationSchema } from "@/lib/flows/implementation";

const CompiledNodeSchema = z
  .object({
    version: z.literal(2),
    nodeId: PolicyIdSchema,
    templateKind: z.enum(["DEPOSIT_TRIGGER", "PAYER", "SPLITTER", "ROUTER"]),
    implementation: PipelineImplementationSchema,
    initialState: ConditionalNodeStateSchema,
  })
  .strict();

/** JSON-only equality for strict domain values; object insertion order is not
 * evidence, while every array position (including both branch roles) is. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}

/** Original, explicitly tagged construction evidence. Parsing does not establish
 * executable provenance or enable conditional deployment on any network. */
export const ConditionalDeploymentEnvelopeSchema = z
  .object({
    version: z.literal(2),
    generation: z.literal("conditional-v2"),
    definition: ConditionalDefinitionSchema,
    manifest: ConditionalGraphManifestSchema,
    nodes: z.array(CompiledNodeSchema).min(4).max(REUSABLE_LIMITS.nodes),
  })
  .strict()
  .superRefine((envelope, ctx) => {
    try {
      const compiled = compileConditionalPipeline(
        envelope.definition,
        envelope.manifest.nodes.map(({ wasmHash, state }) => ({
          nodeId: state.nodeId,
          contractAddress: state.contractAddress,
          expectedRevision: "0",
          wasmHash,
        })),
      );
      if (
        canonical(compiled.manifest) !== canonical(envelope.manifest) ||
        canonical(compiled.nodes) !== canonical(envelope.nodes)
      )
        ctx.addIssue({
          code: "custom",
          message: "Conditional construction evidence must match the complete compiler output",
        });
    } catch {
      ctx.addIssue({ code: "custom", message: "Invalid conditional construction evidence" });
    }
  });
export type ConditionalDeploymentEnvelope = z.infer<typeof ConditionalDeploymentEnvelopeSchema>;

/** Only explicit generation markers select this protocol. Malformed tagged
 * evidence must still enter the strict parser and fail, never become legacy. */
export function hasConditionalDeploymentDeclaration(raw: unknown): boolean {
  return (
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    ("generation" in raw || ("version" in raw && raw.version !== 1))
  );
}

/** Derive current semantic graph from decoded states only after the reader has
 * compared each immutable leaf to the original construction evidence. */
export function conditionalDefinitionFromStates(
  original: ConditionalDefinition,
  states: z.infer<typeof ConditionalNodeStateSchema>[],
): ConditionalDefinition {
  const condition = states.at(-3)?.configuration;
  const terminal = (index: number) => {
    const state = states.at(index);
    if (!state) throw new Error("Missing terminal configuration");
    const configuration = state.configuration;
    if (configuration.kind === "return_to_owner")
      return { kind: "return_to_owner" as const, nodeId: state.nodeId };
    if (configuration.kind !== "pay" && configuration.kind !== "split")
      throw new Error("Invalid terminal configuration");
    return configuration;
  };
  if (condition?.kind !== "condition") throw new Error("Missing amount condition");
  return ConditionalDefinitionSchema.parse({
    ...original,
    prefix: states.slice(1, -3).map(({ configuration }) => {
      if (configuration.kind !== "pay") throw new Error("Invalid upstream configuration");
      return configuration;
    }),
    condition: {
      ...original.condition,
      kind: condition.comparison,
      thresholdStroops: condition.thresholdStroops,
      thresholdMode: condition.thresholdMode,
    },
    trueBranch: terminal(-2),
    falseBranch: terminal(-1),
  });
}
