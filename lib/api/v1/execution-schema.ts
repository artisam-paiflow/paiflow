import { z } from "zod";
import {
  ArtifactCapabilitiesSchema,
  ConfirmedNodeConfigurationSchema,
  ConfigurationRevisionSchema,
  ContractAddressSchema,
  FlowFieldPoliciesSchema,
  PolicyIdSchema,
} from "@/lib/flows/field-policies";

export const ExecutionDiscoverySchema = z.discriminatedUnion("supported", [
  z
    .object({
      supported: z.literal(false),
      deploymentId: z.uuid(),
      network: z.enum(["testnet", "mainnet"]),
      policyVersion: z.literal(0),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      supported: z.literal(true),
      deploymentId: z.uuid(),
      network: z.enum(["testnet", "mainnet"]),
      policyVersion: z.literal(1),
      confirmedLedger: z.number().int().positive().max(0xffff_ffff),
      rootContract: ContractAddressSchema,
      assetContract: ContractAddressSchema,
      minAmountStroops: z.string().regex(/^(0|[1-9]\d*)$/),
      policies: FlowFieldPoliciesSchema,
      nodes: z
        .array(
          z
            .object({
              nodeId: PolicyIdSchema,
              contractAddress: ContractAddressSchema,
              expectedRevision: ConfigurationRevisionSchema,
              capabilities: ArtifactCapabilitiesSchema.refine(
                (capability) =>
                  capability.policyVersion === 1 && capability.execution && !capability.mutation,
                "Execution requires an enforced v1 artifact",
              ),
            })
            .strict(),
        )
        .min(2)
        .max(40),
      configurations: z.array(ConfirmedNodeConfigurationSchema).min(1).max(39),
    })
    .strict()
    .superRefine((state, ctx) => {
      if (
        state.nodes[0]?.contractAddress !== state.rootContract ||
        state.configurations.length !== state.nodes.length - 1 ||
        new Set(state.nodes.map((node) => node.nodeId)).size !== state.nodes.length ||
        new Set(state.nodes.map((node) => node.contractAddress)).size !== state.nodes.length
      )
        ctx.addIssue({
          code: "custom",
          message: "Execution state must identify one complete unambiguous path",
        });
      if (
        state.configurations.some(
          (configuration, index) =>
            configuration.nodeId !== state.nodes[index + 1]?.nodeId ||
            configuration.contractAddress !== state.nodes[index + 1]?.contractAddress ||
            configuration.revision !== state.nodes[index + 1]?.expectedRevision ||
            configuration.confirmedLedger !== state.confirmedLedger,
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Configuration evidence must match its contract, revision and confirmed ledger",
        });
    }),
]);
export type ExecutionDiscovery = z.infer<typeof ExecutionDiscoverySchema>;
export const ExecutionReconcileSchema = z.object({ intent: z.uuid() }).strict();
export type ExecutionReconcile = z.infer<typeof ExecutionReconcileSchema>;
export const ExecutionArtifactsSchema = z
  .array(
    z
      .object({
        nodeId: PolicyIdSchema,
        contractAddress: ContractAddressSchema,
        wasmHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  )
  .min(2)
  .max(40)
  .superRefine((artifacts, ctx) => {
    if (
      new Set(artifacts.map((artifact) => artifact.nodeId)).size !== artifacts.length ||
      new Set(artifacts.map((artifact) => artifact.contractAddress)).size !== artifacts.length
    )
      ctx.addIssue({ code: "custom", message: "Execution artifact bindings must be unique" });
  });
export type ExecutionArtifacts = z.infer<typeof ExecutionArtifactsSchema>;

/** Detect explicit declarations before parsing; malformed declarations cannot
 * silently fall back to legacy behavior. Mode-less evidence stays compatible. */
export function hasExecutionPolicies(graph: unknown): boolean {
  return (
    typeof graph === "object" &&
    graph !== null &&
    !Array.isArray(graph) &&
    Object.hasOwn(graph, "fieldPolicies")
  );
}
