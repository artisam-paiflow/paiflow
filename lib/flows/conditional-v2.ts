import { z } from "zod";
import {
  ConfigurationRevisionSchema,
  ConfirmedNodeConfigurationSchema,
  ContractAddressSchema,
  NodeExecutionInputSchema,
  PayFieldPolicySchema,
  PayMutationInputSchema,
  PolicyIdSchema,
  REUSABLE_LIMITS,
  SplitFieldPolicySchema,
  SplitMutationInputSchema,
  StoredPayConfigurationSchema,
  StoredSplitConfigurationSchema,
  StroopsSchema,
  WalletAddressSchema,
  executionArgumentsSchema,
  type NodeExecutionInput,
} from "@/lib/flows/field-policies";

/** Design-only wire generation. No runtime, registry or artifact capability is
 * enabled by accepting this normalized domain. See docs/conditional-v2.md. */
export const CONDITIONAL_VERSION = 2;
export const NonnegativeStroopsSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .max(REUSABLE_LIMITS.maxStroops.length)
  .refine(
    (value) =>
      /^(0|[1-9]\d*)$/.test(value) &&
      value.length <= REUSABLE_LIMITS.maxStroops.length &&
      BigInt(value) <= BigInt(REUSABLE_LIMITS.maxStroops),
    "Integer exceeds supported range",
  );
export type NonnegativeStroops = z.infer<typeof NonnegativeStroopsSchema>;
export const ConditionalBranchSchema = z.enum(["true", "false"]);
export type ConditionalBranch = z.infer<typeof ConditionalBranchSchema>;
export const ConditionalPayNodeSchema = z
  .object({
    kind: z.literal("pay"),
    nodeId: PolicyIdSchema,
    policy: PayFieldPolicySchema,
    configuration: StoredPayConfigurationSchema,
  })
  .strict();
export type ConditionalPayNode = z.infer<typeof ConditionalPayNodeSchema>;
export const ConditionalSplitNodeSchema = z
  .object({
    kind: z.literal("split"),
    nodeId: PolicyIdSchema,
    policy: SplitFieldPolicySchema,
    configuration: StoredSplitConfigurationSchema,
  })
  .strict();
export type ConditionalSplitNode = z.infer<typeof ConditionalSplitNodeSchema>;
export const ConditionalReturnNodeSchema = z
  .object({
    kind: z.literal("return_to_owner"),
    nodeId: PolicyIdSchema,
  })
  .strict();
export type ConditionalReturnNode = z.infer<typeof ConditionalReturnNodeSchema>;
export const ConditionalTerminalSchema = z.discriminatedUnion("kind", [
  ConditionalPayNodeSchema,
  ConditionalSplitNodeSchema,
  ConditionalReturnNodeSchema,
]);
export type ConditionalTerminal = z.infer<typeof ConditionalTerminalSchema>;
export const ConditionalConditionSchema = z
  .object({
    nodeId: PolicyIdSchema,
    kind: z.enum(["amount_gt", "amount_lt"]),
    thresholdStroops: NonnegativeStroopsSchema,
    thresholdMode: z.enum(["constant", "mutable"]).default("constant"),
  })
  .strict();
export type ConditionalCondition = z.infer<typeof ConditionalConditionSchema>;
export const ConditionalStoredConditionConfigurationSchema = z
  .object({
    kind: z.literal("condition"),
    comparison: z.enum(["amount_gt", "amount_lt"]),
    thresholdStroops: NonnegativeStroopsSchema,
  })
  .strict();
export type ConditionalStoredConditionConfiguration = z.infer<
  typeof ConditionalStoredConditionConfigurationSchema
>;

const DefinitionShape = z
  .object({
    version: z.literal(CONDITIONAL_VERSION),
    assetContract: ContractAddressSchema,
    owner: WalletAddressSchema,
    root: z
      .object({
        nodeId: PolicyIdSchema,
        minAmountStroops: NonnegativeStroopsSchema.default("0"),
      })
      .strict(),
    prefix: z.array(ConditionalPayNodeSchema).max(REUSABLE_LIMITS.nodes - 4),
    condition: ConditionalConditionSchema,
    trueBranch: ConditionalTerminalSchema,
    falseBranch: ConditionalTerminalSchema,
  })
  .strict();
type DefinitionShape = z.infer<typeof DefinitionShape>;

function orderedNodes(definition: DefinitionShape) {
  return [
    definition.root,
    ...definition.prefix,
    definition.condition,
    definition.trueBranch,
    definition.falseBranch,
  ];
}
function paymentNodes(definition: DefinitionShape) {
  return [...definition.prefix, definition.trueBranch, definition.falseBranch].filter(
    (node): node is ConditionalPayNode | ConditionalSplitNode => node.kind !== "return_to_owner",
  );
}
/** Reuse v1 policy/configuration invariants without changing its runtime union.
 * Placeholder ledger/revision/address here are only a pure value-validation
 * adapter; they make no chain-observation or artifact-trust claim. */
function paymentSnapshot(node: ConditionalPayNode | ConditionalSplitNode, assetContract: string) {
  return {
    version: 1 as const,
    nodeId: node.nodeId,
    contractAddress: assetContract,
    confirmedLedger: 1,
    revision: "0",
    policy: node.policy,
    configuration: node.configuration,
  };
}
/** Intrinsic v2 payment-state validation shared by definitions and event/getter
 * decoding. Address is only a valid placeholder for the v1 value adapter. */
export function conditionalPaymentNodeSchema(contractAddress: string) {
  return z
    .discriminatedUnion("kind", [ConditionalPayNodeSchema, ConditionalSplitNodeSchema])
    .superRefine((node, ctx) => {
      const result = ConfirmedNodeConfigurationSchema.safeParse(
        paymentSnapshot(node, contractAddress),
      );
      if (!result.success) {
        for (const issue of result.error.issues)
          ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
        return;
      }
      if (node.kind !== "split") return;
      const rows = [
        ...node.configuration.configuredRows,
        ...node.configuration.additionalRecipients,
      ];
      if (node.policy.allocationMode === "fixed") {
        // The successful shared value parse above is required before BigInt:
        // refinements can otherwise run after nested regex failures in Zod.
        const total = rows.reduce(
          (sum, row) =>
            sum + (row.allocation?.kind === "fixed" ? BigInt(row.allocation.amountStroops) : 0n),
          0n,
        );
        if (total > BigInt(REUSABLE_LIMITS.maxStroops))
          ctx.addIssue({ code: "custom", message: "Stored Split total exceeds i128" });
      } else {
        const knownTotal = rows.reduce(
          (sum, row) => sum + (row.allocation?.kind === "percentage" ? row.allocation.bps : 0),
          0,
        );
        const requiredSlots = node.configuration.configuredRows.filter(
          (row) => row.allocation === undefined,
        ).length;
        if (knownTotal + requiredSlots > 10000)
          ctx.addIssue({
            code: "custom",
            message: "Stored percentages leave no room for declared positive allocations",
          });
      }
    });
}
export const ConditionalDefinitionSchema = DefinitionShape.superRefine((definition, ctx) => {
  const ids = orderedNodes(definition).map((node) => node.nodeId);
  if (new Set(ids).size !== ids.length)
    ctx.addIssue({ code: "custom", message: "Every graph node must have a unique ID" });
  for (const node of paymentNodes(definition)) {
    const result = conditionalPaymentNodeSchema(definition.assetContract).safeParse(node);
    if (!result.success)
      for (const issue of result.error.issues)
        ctx.addIssue({
          code: "custom",
          path: [node.nodeId, ...issue.path],
          message: issue.message,
        });
  }
  definition.prefix.forEach((node, index) => {
    const value = node.configuration.payoutValue;
    if (value.kind === "full" || (value.kind === "percentage" && value.bps === 10_000))
      ctx.addIssue({
        code: "custom",
        path: ["prefix", index],
        message: "Prefix Pay must leave a downstream budget",
      });
  });
});
export type ConditionalDefinition = z.infer<typeof ConditionalDefinitionSchema>;

/** Complete canonical order includes both branches, even for selected-only inputs. */
export function conditionalNodeOrder(definition: ConditionalDefinition): string[] {
  return orderedNodes(ConditionalDefinitionSchema.parse(definition)).map((node) => node.nodeId);
}
function invalid(message: string): never {
  throw new z.ZodError([{ code: "custom", path: [], message }]);
}
/** Amounts come from this invocation, never a contract's pooled balance. Bigint
 * multiplication preserves floor division through i128 max (Rust must use an
 * equally safe wide intermediate or quotient/remainder decomposition). */
export function selectConditionalBranch(definition_: ConditionalDefinition, amountStroops: string) {
  const definition = ConditionalDefinitionSchema.parse(definition_);
  let incoming = BigInt(StroopsSchema.parse(amountStroops));
  if (incoming < BigInt(definition.root.minAmountStroops)) invalid("Root minimum is not met");
  for (const node of definition.prefix) {
    const value = node.configuration.payoutValue;
    const payout =
      value.kind === "fixed"
        ? BigInt(value.amountStroops)
        : value.kind === "percentage"
          ? (incoming * BigInt(value.bps)) / 10_000n
          : incoming;
    if (payout >= incoming) invalid("Prefix Pay must leave a positive condition amount");
    incoming -= payout;
  }
  const threshold = BigInt(definition.condition.thresholdStroops);
  const passes =
    definition.condition.kind === "amount_gt" ? incoming > threshold : incoming < threshold;
  return {
    amountAtConditionStroops: incoming.toString(),
    selectedBranch: (passes ? "true" : "false") as ConditionalBranch,
  };
}
function activeNodes(definition: ConditionalDefinition, selectedBranch: ConditionalBranch) {
  const terminal = selectedBranch === "true" ? definition.trueBranch : definition.falseBranch;
  return [...definition.prefix, ...(terminal.kind === "return_to_owner" ? [] : [terminal])];
}
export const ConditionalExecutionArgumentsSchema = z
  .object({
    version: z.literal(CONDITIONAL_VERSION),
    inputs: z.array(NodeExecutionInputSchema).max(REUSABLE_LIMITS.nodes),
  })
  .strict()
  .superRefine((arguments_, ctx) => {
    const ids = arguments_.inputs.map((input) => input.nodeId);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", path: ["inputs"], message: "Duplicate execution input" });
  });
export type ConditionalExecutionArguments = z.infer<typeof ConditionalExecutionArgumentsSchema>;

function requiresInput(node: ConditionalPayNode | ConditionalSplitNode) {
  const policy = node.policy;
  return policy.kind === "pay"
    ? policy.recipient === "execution"
    : policy.additionalRecipients === "execution" ||
        policy.rows.some((row) => row.recipient === "execution" || row.allocation === "execution");
}
/** Final merged values, not just input presence, must conserve the selected
 * invocation. Constant-only fixed Split accumulation is intentionally retained. */
function validateTerminalValues(
  definition: ConditionalDefinition,
  selectedBranch: ConditionalBranch,
  amountAtConditionStroops: string,
  inputs: NodeExecutionInput[],
) {
  const node = selectedBranch === "true" ? definition.trueBranch : definition.falseBranch;
  const incoming = BigInt(amountAtConditionStroops);
  if (node.kind === "return_to_owner") return;
  const input = inputs.find((candidate) => candidate.nodeId === node.nodeId);
  if (node.kind === "pay") {
    const value = node.configuration.payoutValue;
    if (value.kind === "fixed" && BigInt(value.amountStroops) > incoming)
      invalid("Terminal fixed Pay is underfunded");
    return;
  }
  const configuration = node.configuration;
  const rows = configuration.configuredRows.map((row) => {
    const override =
      input?.kind === "split"
        ? input.rows.find((candidate) => candidate.rowId === row.rowId)
        : undefined;
    return {
      rowId: row.rowId,
      recipient: override?.recipient ?? row.recipient,
      allocation: override?.allocation ?? row.allocation,
    };
  });
  rows.push(...configuration.additionalRecipients);
  if (input?.kind === "split") rows.push(...(input.additionalRecipients ?? []));
  if (
    rows.length < 1 ||
    rows.length > REUSABLE_LIMITS.recipients ||
    rows.some((row) => row.recipient === undefined || row.allocation === undefined) ||
    new Set(rows.map((row) => row.recipient)).size !== rows.length ||
    new Set(rows.map((row) => row.rowId)).size !== rows.length
  )
    invalid("Invalid final Split recipient roster");
  if (node.policy.allocationMode === "percentage") {
    if (
      rows.reduce(
        (total, row) => total + (row.allocation?.kind === "percentage" ? row.allocation.bps : 0),
        0,
      ) !== 10_000
    )
      invalid("Final percentages must total 10000 bps");
  } else {
    const total = rows.reduce(
      (sum, row) =>
        sum + (row.allocation?.kind === "fixed" ? BigInt(row.allocation.amountStroops) : 0n),
      0n,
    );
    if (total > BigInt(REUSABLE_LIMITS.maxStroops)) invalid("Final Split total exceeds i128");
    if (input && total !== incoming)
      invalid("Execution-aware fixed Split requires exact incoming funding");
  }
}
export function conditionalExecutionArgumentsSchema(
  definition_: ConditionalDefinition,
  amountStroops: string,
) {
  const definition = ConditionalDefinitionSchema.parse(definition_);
  const selection = selectConditionalBranch(definition, amountStroops);
  const active = activeNodes(definition, selection.selectedBranch);
  return ConditionalExecutionArgumentsSchema.superRefine((arguments_, ctx) => {
    const validation = executionArgumentsSchema({
      version: 1,
      nodes: active.map((node) => node.policy),
    }).safeParse({ version: 1, inputs: arguments_.inputs });
    if (!validation.success) {
      for (const issue of validation.error.issues) ctx.addIssue({ ...issue });
      return;
    }
    const expected = active.filter(requiresInput).map((node) => node.nodeId);
    if (arguments_.inputs.some((input, index) => input.nodeId !== expected[index]))
      ctx.addIssue({
        code: "custom",
        path: ["inputs"],
        message: "Inputs must follow selected prefix then branch order",
      });
    for (const input of arguments_.inputs) {
      if (input.kind !== "split") continue;
      const node = active.find((candidate) => candidate.nodeId === input.nodeId);
      if (node?.kind !== "split") continue;
      const order = node.policy.rows.filter(
        (row) => row.recipient === "execution" || row.allocation === "execution",
      );
      if (input.rows.some((row, index) => row.rowId !== order[index]?.rowId))
        ctx.addIssue({
          code: "custom",
          path: ["inputs"],
          message: "Input rows must retain configured order",
        });
    }
    try {
      validateTerminalValues(
        definition,
        selection.selectedBranch,
        selection.amountAtConditionStroops,
        arguments_.inputs,
      );
    } catch (error) {
      if (!(error instanceof z.ZodError)) throw error;
      for (const issue of error.issues) ctx.addIssue({ ...issue });
    }
  });
}

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const ConditionalBindingSchema = z
  .object({
    nodeId: PolicyIdSchema,
    contractAddress: ContractAddressSchema,
    expectedRevision: ConfigurationRevisionSchema,
    wasmHash: HashSchema,
  })
  .strict();
export type ConditionalBinding = z.infer<typeof ConditionalBindingSchema>;
export function conditionalBindingsSchema(definition_: ConditionalDefinition) {
  const definition = ConditionalDefinitionSchema.parse(definition_);
  const order = conditionalNodeOrder(definition);
  const fixedRevisionIds = [
    definition.root.nodeId,
    ...[definition.trueBranch, definition.falseBranch]
      .filter((node) => node.kind === "return_to_owner")
      .map((node) => node.nodeId),
  ];
  return z
    .array(ConditionalBindingSchema)
    .min(4)
    .max(REUSABLE_LIMITS.nodes)
    .superRefine((bindings, ctx) => {
      if (
        bindings.length !== order.length ||
        bindings.some((binding, index) => binding.nodeId !== order[index])
      )
        ctx.addIssue({
          code: "custom",
          message: "Bindings must cover the complete graph in canonical order",
        });
      if (new Set(bindings.map((binding) => binding.contractAddress)).size !== bindings.length)
        ctx.addIssue({ code: "custom", message: "Each node requires a distinct contract address" });
      if (
        bindings.some(
          (binding) =>
            fixedRevisionIds.includes(binding.nodeId) && binding.expectedRevision !== "0",
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Root and immutable owner return revisions are zero",
        });
    });
}
export const ConditionalExecutionIntentSchema = z
  .object({
    version: z.literal(CONDITIONAL_VERSION),
    deploymentId: z.uuid(),
    networkPassphraseHash: HashSchema,
    rootContract: ContractAddressSchema,
    assetContract: ContractAddressSchema,
    payer: WalletAddressSchema,
    amountStroops: StroopsSchema,
    nonce: HashSchema,
    expiresAtLedger: z.number().int().min(1).max(0xffff_ffff),
    definition: ConditionalDefinitionSchema,
    nodes: z.array(ConditionalBindingSchema).min(4).max(REUSABLE_LIMITS.nodes),
    arguments: ConditionalExecutionArgumentsSchema,
    selectedBranch: ConditionalBranchSchema,
    amountAtConditionStroops: StroopsSchema,
  })
  .strict()
  .superRefine((intent, ctx) => {
    if (!ConditionalDefinitionSchema.safeParse(intent.definition).success) return;
    const bindings = conditionalBindingsSchema(intent.definition).safeParse(intent.nodes);
    if (!bindings.success)
      for (const issue of bindings.error.issues)
        ctx.addIssue({ ...issue, path: ["nodes", ...issue.path] });
    if (
      intent.nodes[0]?.contractAddress !== intent.rootContract ||
      intent.assetContract !== intent.definition.assetContract
    )
      ctx.addIssue({ code: "custom", message: "Root and asset must match the complete graph" });
    try {
      const selection = selectConditionalBranch(intent.definition, intent.amountStroops);
      if (
        selection.selectedBranch !== intent.selectedBranch ||
        selection.amountAtConditionStroops !== intent.amountAtConditionStroops
      )
        ctx.addIssue({
          code: "custom",
          message: "Route and condition amount must match verified terms",
        });
      const arguments_ = conditionalExecutionArgumentsSchema(
        intent.definition,
        intent.amountStroops,
      ).safeParse(intent.arguments);
      if (!arguments_.success)
        for (const issue of arguments_.error.issues)
          ctx.addIssue({ ...issue, path: ["arguments", ...issue.path] });
    } catch (error) {
      if (!(error instanceof z.ZodError)) throw error;
      for (const issue of error.issues) ctx.addIssue({ ...issue });
    }
  });
export type ConditionalExecutionIntent = z.infer<typeof ConditionalExecutionIntentSchema>;

export const ConditionalThresholdMutationSchema = z
  .object({
    kind: z.literal("condition"),
    nodeId: PolicyIdSchema,
    expectedRevision: ConfigurationRevisionSchema,
    thresholdStroops: NonnegativeStroopsSchema,
  })
  .strict();
export type ConditionalThresholdMutation = z.infer<typeof ConditionalThresholdMutationSchema>;
export const ConditionalMutationArgumentsSchema = z
  .object({
    version: z.literal(CONDITIONAL_VERSION),
    changes: z
      .array(
        z.discriminatedUnion("kind", [
          PayMutationInputSchema,
          SplitMutationInputSchema,
          ConditionalThresholdMutationSchema,
        ]),
      )
      .min(1)
      .max(REUSABLE_LIMITS.nodes),
  })
  .strict()
  .superRefine((arguments_, ctx) => {
    if (
      new Set(arguments_.changes.map((change) => change.nodeId)).size !== arguments_.changes.length
    )
      ctx.addIssue({ code: "custom", path: ["changes"], message: "Duplicate mutation node" });
  });
export type ConditionalMutationArguments = z.infer<typeof ConditionalMutationArgumentsSchema>;

/** Pure policy/value preflight only: trusted readers and contracts must also
 * enforce whole-graph accounted obligations and authorization atomically. */
export function conditionalMutationArgumentsSchema(
  definition_: ConditionalDefinition,
  bindings_: ConditionalBinding[],
) {
  const definition = ConditionalDefinitionSchema.parse(definition_);
  const bindings = conditionalBindingsSchema(definition).parse(bindings_);
  return ConditionalMutationArgumentsSchema.superRefine((arguments_, ctx) => {
    const order = conditionalNodeOrder(definition);
    const positions = arguments_.changes.map((change) => order.indexOf(change.nodeId));
    if (
      positions.some(
        (position, index) => position < 0 || (index > 0 && position <= positions[index - 1]!),
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["changes"],
        message: "Changes must follow complete graph order",
      });
    const next = structuredClone(definition);
    for (const [index, change] of arguments_.changes.entries()) {
      const fail = (message: string) =>
        ctx.addIssue({ code: "custom", path: ["changes", index], message });
      const binding = bindings.find((binding) => binding.nodeId === change.nodeId);
      if (!binding || binding.expectedRevision !== change.expectedRevision) {
        fail("Unknown node or stale revision");
        continue;
      }
      if (change.expectedRevision === REUSABLE_LIMITS.maxRevision) {
        fail("Configuration revision exhausted");
        continue;
      }
      if (change.kind === "condition") {
        if (change.nodeId !== next.condition.nodeId || next.condition.thresholdMode !== "mutable") {
          fail("Threshold is not declared mutable");
          continue;
        }
        if (change.thresholdStroops === next.condition.thresholdStroops)
          fail("Each changed node requires an actual change");
        next.condition.thresholdStroops = change.thresholdStroops;
        continue;
      }
      const node = paymentNodes(next).find((node) => node.nodeId === change.nodeId);
      if (!node || node.kind !== change.kind) {
        fail("Unknown or immutable mutation node");
        continue;
      }
      const previous = JSON.stringify(node.configuration);
      if (change.kind === "pay" && node.kind === "pay") {
        if (change.recipient !== undefined) {
          if (node.policy.recipient !== "mutable") fail("Recipient is not declared mutable");
          else node.configuration.recipient = change.recipient;
        }
        if (change.payoutValue !== undefined) {
          if (
            node.policy.payoutValue !== "mutable" ||
            node.configuration.payoutValue.kind !== change.payoutValue.kind
          )
            fail("Payout value or mode is immutable");
          else node.configuration.payoutValue = change.payoutValue;
        }
      } else if (change.kind === "split" && node.kind === "split") {
        for (const row of change.rows) {
          const rowIndex = node.policy.rows.findIndex((candidate) => candidate.rowId === row.rowId);
          const policy = node.policy.rows[rowIndex];
          const current = node.configuration.configuredRows[rowIndex];
          if (!policy || !current) {
            fail("Unknown configured row");
            continue;
          }
          if (row.recipient !== undefined) {
            if (policy.recipient !== "mutable") fail("Recipient is not declared mutable");
            else current.recipient = row.recipient;
          }
          if (row.allocation !== undefined) {
            if (
              policy.allocation !== "mutable" ||
              row.allocation.kind !== node.policy.allocationMode
            )
              fail("Allocation or mode is immutable");
            else current.allocation = row.allocation;
          }
        }
        if (change.additionalRecipients !== undefined) {
          if (node.policy.additionalRecipients !== "mutable")
            fail("Additional roster is not declared mutable");
          else node.configuration.additionalRecipients = change.additionalRecipients;
        }
      }
      if (JSON.stringify(node.configuration) === previous)
        fail("Each changed node requires an actual change");
    }
    const result = ConditionalDefinitionSchema.safeParse(next);
    if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ ...issue });
  });
}

/** Prepared token-free update evidence; it still requires a trusted current read,
 * whole-graph obligation admission and exact admin authorization on chain. */
export const ConditionalMutationIntentSchema = z
  .object({
    version: z.literal(CONDITIONAL_VERSION),
    deploymentId: z.uuid(),
    networkPassphraseHash: HashSchema,
    rootContract: ContractAddressSchema,
    admin: WalletAddressSchema,
    definition: ConditionalDefinitionSchema,
    nodes: z.array(ConditionalBindingSchema).min(4).max(REUSABLE_LIMITS.nodes),
    arguments: ConditionalMutationArgumentsSchema,
  })
  .strict()
  .superRefine((intent, ctx) => {
    if (!ConditionalDefinitionSchema.safeParse(intent.definition).success) return;
    const bindings = conditionalBindingsSchema(intent.definition).safeParse(intent.nodes);
    if (!bindings.success) {
      for (const issue of bindings.error.issues)
        ctx.addIssue({ code: "custom", path: ["nodes", ...issue.path], message: issue.message });
      return;
    }
    if (
      intent.rootContract !== intent.nodes[0]?.contractAddress ||
      intent.admin !== intent.definition.owner
    )
      ctx.addIssue({ code: "custom", message: "Mutation root/admin must match immutable graph" });
    const changes = conditionalMutationArgumentsSchema(intent.definition, bindings.data).safeParse(
      intent.arguments,
    );
    if (!changes.success)
      for (const issue of changes.error.issues)
        ctx.addIssue({
          code: "custom",
          path: ["arguments", ...issue.path],
          message: issue.message,
        });
  });
export type ConditionalMutationIntent = z.infer<typeof ConditionalMutationIntentSchema>;
