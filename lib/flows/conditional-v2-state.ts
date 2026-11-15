import { z } from "zod";
import {
  ConfigurationRevisionSchema,
  ContractAddressSchema,
  PolicyIdSchema,
  REUSABLE_LIMITS,
  WalletAddressSchema,
} from "@/lib/flows/field-policies";
import {
  ConditionalBindingSchema,
  ConditionalDefinitionSchema,
  ConditionalPayNodeSchema,
  ConditionalSplitNodeSchema,
  NonnegativeStroopsSchema,
  conditionalBindingsSchema,
  conditionalPaymentNodeSchema,
  type ConditionalDefinition,
} from "@/lib/flows/conditional-v2";

/** Decoded v2 getter/event values only. Parsing never proves chain provenance or
 * enables capability; the reader must verify pinned artifacts and instance fences. */
export const ConditionalNodeConfigurationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("receive"), minAmountStroops: NonnegativeStroopsSchema }).strict(),
  ConditionalPayNodeSchema,
  ConditionalSplitNodeSchema,
  z
    .object({
      kind: z.literal("condition"),
      comparison: z.enum(["amount_gt", "amount_lt"]),
      thresholdStroops: NonnegativeStroopsSchema,
      thresholdMode: z.enum(["constant", "mutable"]),
    })
    .strict(),
  z.object({ kind: z.literal("return_to_owner"), recipient: WalletAddressSchema }).strict(),
]);

function hasMutableConfiguration(
  config: z.infer<typeof ConditionalNodeConfigurationSchema>,
): boolean {
  switch (config.kind) {
    case "condition":
      return config.thresholdMode === "mutable";
    case "pay":
      return config.policy.recipient === "mutable" || config.policy.payoutValue === "mutable";
    case "split":
      return (
        config.policy.additionalRecipients === "mutable" ||
        config.policy.rows.some(
          (row) => row.recipient === "mutable" || row.allocation === "mutable",
        )
      );
    case "receive":
    case "return_to_owner":
      return false;
    default: {
      const exhaustive: never = config;
      return exhaustive;
    }
  }
}

export const ConditionalNodeStateSchema = z
  .object({
    version: z.literal(2),
    nodeId: PolicyIdSchema,
    contractAddress: ContractAddressSchema,
    revision: ConfigurationRevisionSchema,
    admin: WalletAddressSchema,
    assetContract: ContractAddressSchema,
    parentContract: ContractAddressSchema.nullable(),
    nextContracts: z.array(ContractAddressSchema).max(2),
    configuration: ConditionalNodeConfigurationSchema,
  })
  .strict()
  .superRefine((state, ctx) => {
    const config = state.configuration;
    if (config.kind === "pay" || config.kind === "split") {
      const result = conditionalPaymentNodeSchema(state.contractAddress).safeParse(config);
      if (config.nodeId !== state.nodeId)
        ctx.addIssue({ code: "custom", message: "Configuration identity must match node" });
      if (!result.success)
        for (const issue of result.error.issues)
          ctx.addIssue({
            code: "custom",
            path: ["configuration", ...issue.path],
            message: issue.message,
          });
    }
    if (
      config.kind === "pay" &&
      state.nextContracts.length > 0 &&
      (config.configuration.payoutValue.kind === "full" ||
        (config.configuration.payoutValue.kind === "percentage" &&
          config.configuration.payoutValue.bps === 10000))
    )
      ctx.addIssue({ code: "custom", message: "A full Pay cannot forward to a successor" });
    if (config.kind === "return_to_owner" && config.recipient !== state.admin)
      ctx.addIssue({ code: "custom", message: "Owner return destination is the immutable admin" });
    if (!hasMutableConfiguration(config) && state.revision !== "0")
      ctx.addIssue({ code: "custom", message: "Immutable nodes remain at revision zero" });
    if (
      (state.parentContract === null) !== (config.kind === "receive") ||
      state.parentContract === state.contractAddress ||
      state.nextContracts.includes(state.contractAddress) ||
      new Set(state.nextContracts).size !== state.nextContracts.length ||
      (config.kind === "receive" && state.nextContracts.length !== 1) ||
      (config.kind === "condition" && state.nextContracts.length !== 2) ||
      ((config.kind === "split" || config.kind === "return_to_owner") &&
        state.nextContracts.length !== 0) ||
      (config.kind === "pay" && state.nextContracts.length > 1)
    )
      ctx.addIssue({ code: "custom", message: "Invalid node parent or successor shape" });
  });
export type ConditionalNodeState = z.infer<typeof ConditionalNodeStateSchema>;
export const ConditionalMutationStatusSchema = z
  .object({
    state: ConditionalNodeStateSchema,
    obligationsStroops: NonnegativeStroopsSchema,
  })
  .strict();

function expectedConfigurations(definition: ConditionalDefinition) {
  const terminal = (node: ConditionalDefinition["trueBranch"]) =>
    node.kind === "return_to_owner"
      ? { kind: "return_to_owner" as const, recipient: definition.owner }
      : node;
  return [
    { kind: "receive" as const, minAmountStroops: definition.root.minAmountStroops },
    ...definition.prefix,
    {
      kind: "condition" as const,
      comparison: definition.condition.kind,
      thresholdStroops: definition.condition.thresholdStroops,
      thresholdMode: definition.condition.thresholdMode,
    },
    terminal(definition.trueBranch),
    terminal(definition.falseBranch),
  ];
}
export const ConditionalCurrentConfigurationSchema = z
  .object({
    version: z.literal(2),
    confirmedLedger: z.number().int().min(1).max(0xffff_ffff),
    definition: ConditionalDefinitionSchema,
    nodes: z.array(ConditionalBindingSchema).min(4).max(REUSABLE_LIMITS.nodes),
    statuses: z.array(ConditionalMutationStatusSchema).min(4).max(REUSABLE_LIMITS.nodes),
  })
  .strict()
  .superRefine((current, ctx) => {
    if (!ConditionalDefinitionSchema.safeParse(current.definition).success) return;
    const bindings = conditionalBindingsSchema(current.definition).safeParse(current.nodes);
    if (!bindings.success) {
      for (const issue of bindings.error.issues)
        ctx.addIssue({ code: "custom", path: ["nodes", ...issue.path], message: issue.message });
      return;
    }
    if (current.statuses.length !== current.nodes.length)
      ctx.addIssue({
        code: "custom",
        path: ["statuses"],
        message: "Every complete-graph status is required",
      });
    const conditionIndex = current.definition.prefix.length + 1;
    const configurations = expectedConfigurations(current.definition);
    current.statuses.forEach(({ state, obligationsStroops }, index) => {
      const binding = current.nodes[index];
      const expectedParent =
        index === 0
          ? null
          : current.nodes[index > conditionIndex ? conditionIndex : index - 1]!.contractAddress;
      const expectedNext =
        index === conditionIndex
          ? current.nodes.slice(index + 1).map((node) => node.contractAddress)
          : index < conditionIndex
            ? [current.nodes[index + 1]!.contractAddress]
            : [];
      const expectedConfig = configurations[index];
      // Parsing through the same strict union normalizes property order for value
      // equality; no hash/canonical-wire serialization is derived from JSON here.
      const configuration =
        expectedConfig && ConditionalNodeConfigurationSchema.parse(expectedConfig);
      if (
        !binding ||
        state.nodeId !== binding.nodeId ||
        state.contractAddress !== binding.contractAddress ||
        state.revision !== binding.expectedRevision ||
        state.admin !== current.definition.owner ||
        state.assetContract !== current.definition.assetContract ||
        state.parentContract !== expectedParent ||
        JSON.stringify(state.nextContracts) !== JSON.stringify(expectedNext) ||
        JSON.stringify(state.configuration) !== JSON.stringify(configuration)
      )
        ctx.addIssue({
          code: "custom",
          path: ["statuses", index],
          message: "State must match the complete bound graph and verified current definition",
        });
      if (
        (state.configuration.kind === "receive" ||
          state.configuration.kind === "condition" ||
          state.configuration.kind === "return_to_owner") &&
        obligationsStroops !== "0"
      )
        ctx.addIssue({
          code: "custom",
          path: ["statuses", index, "obligationsStroops"],
          message: "Non-holding nodes cannot account obligations",
        });
    });
  });
export type ConditionalCurrentConfiguration = z.infer<typeof ConditionalCurrentConfigurationSchema>;

/** Admission is whole-graph accounting, including inactive-branch debt. Raw token
 * balance, age and observed-history absence do not participate in this predicate. */
export function conditionalMutationAdmissible(current: ConditionalCurrentConfiguration): boolean {
  return ConditionalCurrentConfigurationSchema.parse(current).statuses.every(
    (status) => status.obligationsStroops === "0",
  );
}

/** The emitter/eventId/ledger/hash are trusted ingestion provenance, not values
 * supplied by a contract. This is the config_v2 event data, with an ABI tag. */
export const ConditionalConfigurationEventSchema = ConditionalNodeStateSchema.superRefine(
  (state, ctx) => {
    if (!["pay", "split", "condition"].includes(state.configuration.kind) || state.revision === "0")
      ctx.addIssue({ code: "custom", message: "Only a changed mutable node emits config_v2" });
    const config = state.configuration;
    if (!hasMutableConfiguration(config))
      ctx.addIssue({
        code: "custom",
        message: "Only declared mutable configuration emits config_v2",
      });

    if (
      (config.kind === "pay" || config.kind === "split") &&
      (config.nodeId !== state.nodeId || config.policy.nodeId !== state.nodeId)
    )
      ctx.addIssue({
        code: "custom",
        message: "Event configuration node must match emitter state",
      });
  },
);
