import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";

/** Wire version, not an app/API/SDK release number. See docs/reusable-flows.md. */
export const FIELD_POLICY_VERSION = 1;
export const REUSABLE_LIMITS = {
  nodes: 40,
  recipients: 20,
  idLength: 64,
  maxExecutionLedgerWindow: 720,
  maxStroops: (2n ** 127n - 1n).toString(),
  maxRevision: (2n ** 64n - 1n).toString(),
} as const;
export const PolicyIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export type PolicyId = z.infer<typeof PolicyIdSchema>;
export const FieldModeSchema = z.enum(["constant", "execution", "mutable"]);
export type FieldMode = z.infer<typeof FieldModeSchema>;
const StoredModeSchema = z.enum(["constant", "mutable"]);
export const PayFieldPolicySchema = z
  .object({
    nodeId: PolicyIdSchema,
    kind: z.literal("pay"),
    recipient: FieldModeSchema.default("constant"),
    payoutValue: StoredModeSchema.default("constant"),
  })
  .strict();
export type PayFieldPolicy = z.infer<typeof PayFieldPolicySchema>;
export const SplitRowPolicySchema = z
  .object({
    rowId: PolicyIdSchema,
    recipient: FieldModeSchema.default("constant"),
    allocation: FieldModeSchema.default("constant"),
  })
  .strict();
export type SplitRowPolicy = z.infer<typeof SplitRowPolicySchema>;
export const SplitFieldPolicySchema = z
  .object({
    nodeId: PolicyIdSchema,
    kind: z.literal("split"),
    allocationMode: z.enum(["percentage", "fixed"]),
    rows: z.array(SplitRowPolicySchema).max(REUSABLE_LIMITS.recipients),
    // Constant means no additional rows, not an editable list with defaults.
    additionalRecipients: FieldModeSchema.default("constant"),
  })
  .strict()
  .superRefine((policy, ctx) => {
    const seen = new Set<string>();
    policy.rows.forEach((row, index) => {
      if (seen.has(row.rowId))
        ctx.addIssue({
          code: "custom",
          path: ["rows", index, "rowId"],
          message: "Duplicate row ID",
        });
      seen.add(row.rowId);
    });
    // One allocation group cannot be controlled by two independent authorities.
    const modes = new Set(policy.rows.map((r) => r.allocation).filter((m) => m !== "constant"));
    if (policy.additionalRecipients !== "constant") modes.add(policy.additionalRecipients);
    if (modes.size > 1)
      ctx.addIssue({
        code: "custom",
        message: "Split allocations and additional rows must share one authority",
      });
  });
export type SplitFieldPolicy = z.infer<typeof SplitFieldPolicySchema>;
export const NodeFieldPolicySchema = z.discriminatedUnion("kind", [
  PayFieldPolicySchema,
  SplitFieldPolicySchema,
]);
export type NodeFieldPolicy = z.infer<typeof NodeFieldPolicySchema>;
export const FlowFieldPoliciesSchema = z
  .object({
    version: z.literal(FIELD_POLICY_VERSION),
    nodes: z.array(NodeFieldPolicySchema).max(REUSABLE_LIMITS.nodes),
  })
  .strict()
  .superRefine((policies, ctx) => {
    const seen = new Set<string>();
    policies.nodes.forEach((policy, index) => {
      if (seen.has(policy.nodeId))
        ctx.addIssue({
          code: "custom",
          path: ["nodes", index, "nodeId"],
          message: "Duplicate policy node ID",
        });
      seen.add(policy.nodeId);
    });
  });
export type FlowFieldPolicies = z.infer<typeof FlowFieldPoliciesSchema>;

/** Current artifacts have no v1 policy enforcement. A later compiler must remove
 * this gate only after verified artifact capability discovery, never by a flag. */
export function assertFieldPoliciesDeployable(policies: FlowFieldPolicies | undefined): void {
  if (policies !== undefined)
    throw new Error(
      "Versioned field policies are not supported by the current deployment artifacts",
    );
}

const boundedDecimal = (max: string, positive: boolean) =>
  z
    .string()
    .regex(positive ? /^[1-9]\d*$/ : /^(0|[1-9]\d*)$/)
    .max(max.length)
    .refine(
      (v) => v.length <= max.length && /^\d+$/.test(v) && BigInt(v) <= BigInt(max),
      "Integer exceeds supported range",
    );
export const StroopsSchema = boundedDecimal(REUSABLE_LIMITS.maxStroops, true);
export type Stroops = z.infer<typeof StroopsSchema>;
export const ConfigurationRevisionSchema = boundedDecimal(REUSABLE_LIMITS.maxRevision, false);
export type ConfigurationRevision = z.infer<typeof ConfigurationRevisionSchema>;
export const WalletAddressSchema = z
  .string()
  .refine(StrKey.isValidEd25519PublicKey, "Invalid wallet address");
export type WalletAddress = z.infer<typeof WalletAddressSchema>;
export const ContractAddressSchema = z
  .string()
  .refine(StrKey.isValidContract, "Invalid contract address");
export type ContractAddress = z.infer<typeof ContractAddressSchema>;
export const AllocationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("percentage"), bps: z.number().int().min(1).max(10_000) }).strict(),
  z.object({ kind: z.literal("fixed"), amountStroops: StroopsSchema }).strict(),
]);
export type Allocation = z.infer<typeof AllocationSchema>;
export const SplitRowInputSchema = z
  .object({
    rowId: PolicyIdSchema,
    recipient: WalletAddressSchema.optional(),
    allocation: AllocationSchema.optional(),
  })
  .strict()
  .refine((r) => r.recipient !== undefined || r.allocation !== undefined, "Empty row input");
export type SplitRowInput = z.infer<typeof SplitRowInputSchema>;
export const AdditionalRecipientSchema = z
  .object({
    rowId: PolicyIdSchema,
    recipient: WalletAddressSchema,
    allocation: AllocationSchema,
  })
  .strict();
export type AdditionalRecipient = z.infer<typeof AdditionalRecipientSchema>;
export const PayExecutionInputSchema = z
  .object({
    kind: z.literal("pay"),
    nodeId: PolicyIdSchema,
    recipient: WalletAddressSchema,
  })
  .strict();
export type PayExecutionInput = z.infer<typeof PayExecutionInputSchema>;
export const SplitExecutionInputSchema = z
  .object({
    kind: z.literal("split"),
    nodeId: PolicyIdSchema,
    rows: z.array(SplitRowInputSchema).max(REUSABLE_LIMITS.recipients),
    additionalRecipients: z
      .array(AdditionalRecipientSchema)
      .max(REUSABLE_LIMITS.recipients)
      .optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    for (const row of [...input.rows, ...(input.additionalRecipients ?? [])]) {
      if (seen.has(row.rowId))
        ctx.addIssue({ code: "custom", message: "Duplicate execution row ID" });
      seen.add(row.rowId);
    }
  });
export type SplitExecutionInput = z.infer<typeof SplitExecutionInputSchema>;
export const NodeExecutionInputSchema = z.discriminatedUnion("kind", [
  PayExecutionInputSchema,
  SplitExecutionInputSchema,
]);
export type NodeExecutionInput = z.infer<typeof NodeExecutionInputSchema>;
export const ExecutionArgumentsSchema = z
  .object({
    version: z.literal(1),
    inputs: z.array(NodeExecutionInputSchema).max(REUSABLE_LIMITS.nodes),
  })
  .strict()
  .superRefine((args, ctx) => {
    const seen = new Set<string>();
    args.inputs.forEach((input, i) => {
      if (seen.has(input.nodeId))
        ctx.addIssue({
          code: "custom",
          path: ["inputs", i, "nodeId"],
          message: "Duplicate execution node ID",
        });
      seen.add(input.nodeId);
    });
  });
export type ExecutionArguments = z.infer<typeof ExecutionArgumentsSchema>;

/** All declared inputs, and only declared inputs. No fallback to saved values.
 * Amount conservation/address uniqueness are checked after merging configured
 * constants, in the compiler/API and again on chain (see the ABI handoff). */
export function executionArgumentsSchema(policies: FlowFieldPolicies) {
  return ExecutionArgumentsSchema.superRefine((args, ctx) => {
    const expected = policies.nodes.filter((p) =>
      p.kind === "pay"
        ? p.recipient === "execution"
        : p.additionalRecipients === "execution" ||
          p.rows.some((r) => r.recipient === "execution" || r.allocation === "execution"),
    );
    if (expected.length !== args.inputs.length)
      ctx.addIssue({
        code: "custom",
        path: ["inputs"],
        message: "Every declared execution node is required",
      });
    args.inputs.forEach((input, i) => {
      const policy = expected.find((p) => p.nodeId === input.nodeId && p.kind === input.kind);
      const issue = (message: string) =>
        ctx.addIssue({ code: "custom", path: ["inputs", i], message });
      if (!policy) {
        issue("Unknown or irrelevant execution input");
        return;
      }
      if (input.kind !== "split" || policy.kind !== "split") return;
      const expectedRows = policy.rows.filter(
        (r) => r.recipient === "execution" || r.allocation === "execution",
      );
      if (input.rows.length !== expectedRows.length)
        issue("Every declared execution row is required");
      for (const row of input.rows) {
        const declared = expectedRows.find((r) => r.rowId === row.rowId);
        if (!declared) {
          issue("Unknown row or constant override");
          continue;
        }
        if ((row.recipient !== undefined) !== (declared.recipient === "execution"))
          issue("Missing recipient or constant override");
        if ((row.allocation !== undefined) !== (declared.allocation === "execution"))
          issue("Missing allocation or constant override");
        if (row.allocation && row.allocation.kind !== policy.allocationMode)
          issue("Allocation mode is fixed at deployment");
      }
      if (
        (input.additionalRecipients !== undefined) !==
        (policy.additionalRecipients === "execution")
      )
        issue("Missing additional recipients or constant override");
      const extra = input.additionalRecipients ?? [];
      if (policy.rows.length + extra.length > REUSABLE_LIMITS.recipients)
        issue("Too many split recipients");
      for (const row of extra) {
        if (policy.rows.some((r) => r.rowId === row.rowId))
          issue("Additional row cannot replace a configured row");
        if (row.allocation.kind !== policy.allocationMode)
          issue("Allocation mode is fixed at deployment");
      }
    });
    for (const p of expected)
      if (!args.inputs.some((i) => i.nodeId === p.nodeId && i.kind === p.kind))
        ctx.addIssue({
          code: "custom",
          path: ["inputs"],
          message: `Missing execution input for ${p.nodeId}`,
        });
  });
}

export const ExecutionNodeBindingSchema = z
  .object({
    nodeId: PolicyIdSchema,
    contractAddress: ContractAddressSchema,
    expectedRevision: ConfigurationRevisionSchema,
  })
  .strict();
export type ExecutionNodeBinding = z.infer<typeof ExecutionNodeBindingSchema>;
/** Prepared immutable intent. Server supplies deployment/network/artifact binding;
 * callers never choose the authoritative network or reviewed configuration. */
export const ExecutionIntentSchema = z
  .object({
    version: z.literal(1),
    deploymentId: z.uuid(),
    networkPassphraseHash: z.string().regex(/^[a-f0-9]{64}$/),
    rootContract: ContractAddressSchema,
    assetContract: ContractAddressSchema,
    payer: WalletAddressSchema,
    amountStroops: StroopsSchema,
    nonce: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAtLedger: z.number().int().min(1).max(4_294_967_295),
    nodes: z.array(ExecutionNodeBindingSchema).min(1).max(REUSABLE_LIMITS.nodes),
    arguments: ExecutionArgumentsSchema,
  })
  .strict()
  .superRefine((intent, ctx) => {
    if (intent.nodes[0]?.contractAddress !== intent.rootContract)
      ctx.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "The first binding must identify the root contract",
      });
    const ids = intent.nodes.map((n) => n.nodeId);
    const contracts = intent.nodes.map((n) => n.contractAddress);
    if (new Set(ids).size !== ids.length || new Set(contracts).size !== contracts.length)
      ctx.addIssue({ code: "custom", path: ["nodes"], message: "Duplicate execution binding" });
    for (const input of intent.arguments.inputs)
      if (!ids.includes(input.nodeId))
        ctx.addIssue({
          code: "custom",
          path: ["arguments"],
          message: "Input lacks a contract/revision binding",
        });
  });
export type ExecutionIntent = z.infer<typeof ExecutionIntentSchema>;

/** Discovery reports enforcement observed on a pinned artifact, never inferred
 * from a graph or successful getter on an unrelated address. */
export const ArtifactCapabilitiesSchema = z.discriminatedUnion("policyVersion", [
  z
    .object({
      policyVersion: z.literal(0),
      wasmHash: z.string().regex(/^[a-f0-9]{64}$/),
      execution: z.literal(false),
      mutation: z.literal(false),
    })
    .strict(),
  z
    .object({
      policyVersion: z.literal(1),
      wasmHash: z.string().regex(/^[a-f0-9]{64}$/),
      execution: z.boolean(),
      mutation: z.boolean(),
      immutablePolicies: z.literal(true),
      revisionBinding: z.literal(true),
      executionAbi: z.literal(1),
    })
    .strict(),
]);
export type ArtifactCapabilities = z.infer<typeof ArtifactCapabilitiesSchema>;

/** Template declarations are authored/pinned separately by #1164. Bindings name
 * declared typed leaves; they never contain JSON paths or runtime field modes. */
export const CreationValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("wallet"), value: WalletAddressSchema }).strict(),
  z.object({ type: z.literal("contract"), value: ContractAddressSchema }).strict(),
  z.object({ type: z.literal("stroops"), value: StroopsSchema }).strict(),
  z.object({ type: z.literal("bps"), value: z.number().int().min(1).max(10_000) }).strict(),
  z
    .object({
      type: z.literal("integer"),
      value: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
  z.object({ type: z.literal("timestamp"), value: z.iso.datetime() }).strict(),
  z.object({ type: z.literal("boolean"), value: z.boolean() }).strict(),
  z.object({ type: z.literal("text"), value: z.string().max(280) }).strict(),
]);
export type CreationValue = z.infer<typeof CreationValueSchema>;
export const CreationBindingsSchema = z
  .object({
    version: z.literal(1),
    templateVersionId: z.uuid(),
    values: z
      .array(z.object({ inputId: PolicyIdSchema, value: CreationValueSchema }).strict())
      .max(256),
  })
  .strict()
  .superRefine((bindings, ctx) => {
    const ids = bindings.values.map((v) => v.inputId);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", path: ["values"], message: "Duplicate creation binding" });
  });
export type CreationBindings = z.infer<typeof CreationBindingsSchema>;
export const PayMutationInputSchema = z
  .object({
    kind: z.literal("pay"),
    nodeId: PolicyIdSchema,
    expectedRevision: ConfigurationRevisionSchema,
    recipient: WalletAddressSchema.optional(),
    payoutValue: AllocationSchema.optional(),
  })
  .strict()
  .refine(
    (input) => input.recipient !== undefined || input.payoutValue !== undefined,
    "Empty mutation",
  );
export type PayMutationInput = z.infer<typeof PayMutationInputSchema>;
export const SplitMutationInputSchema = z
  .object({
    kind: z.literal("split"),
    nodeId: PolicyIdSchema,
    expectedRevision: ConfigurationRevisionSchema,
    rows: z.array(SplitRowInputSchema).max(REUSABLE_LIMITS.recipients),
    additionalRecipients: z
      .array(AdditionalRecipientSchema)
      .max(REUSABLE_LIMITS.recipients)
      .optional(),
  })
  .strict()
  .refine(
    (input) => input.rows.length > 0 || input.additionalRecipients !== undefined,
    "Empty mutation",
  )
  .superRefine((input, ctx) => {
    const ids = [...input.rows, ...(input.additionalRecipients ?? [])].map((r) => r.rowId);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "Duplicate mutation row ID" });
    if (ids.length > REUSABLE_LIMITS.recipients)
      ctx.addIssue({ code: "custom", message: "Too many submitted mutation rows" });
  });
export type SplitMutationInput = z.infer<typeof SplitMutationInputSchema>;
export const MutationArgumentsSchema = z
  .object({
    version: z.literal(1),
    changes: z
      .array(z.discriminatedUnion("kind", [PayMutationInputSchema, SplitMutationInputSchema]))
      .min(1)
      .max(REUSABLE_LIMITS.nodes),
  })
  .strict()
  .superRefine((args, ctx) => {
    const ids = args.changes.map((c) => c.nodeId);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", path: ["changes"], message: "Duplicate mutation node ID" });
  });
export type MutationArguments = z.infer<typeof MutationArgumentsSchema>;

export const StoredPayConfigurationSchema = z
  .object({
    kind: z.literal("pay"),
    recipient: WalletAddressSchema.optional(),
    payoutValue: z.union([AllocationSchema, z.object({ kind: z.literal("full") }).strict()]),
  })
  .strict();
export type StoredPayConfiguration = z.infer<typeof StoredPayConfigurationSchema>;
export const StoredSplitRowSchema = z
  .object({
    rowId: PolicyIdSchema,
    recipient: WalletAddressSchema.optional(),
    allocation: AllocationSchema.optional(),
  })
  .strict();
export type StoredSplitRow = z.infer<typeof StoredSplitRowSchema>;
export const StoredSplitConfigurationSchema = z
  .object({
    kind: z.literal("split"),
    configuredRows: z.array(StoredSplitRowSchema).max(REUSABLE_LIMITS.recipients),
    additionalRecipients: z.array(AdditionalRecipientSchema).max(REUSABLE_LIMITS.recipients),
  })
  .strict();
export type StoredSplitConfiguration = z.infer<typeof StoredSplitConfigurationSchema>;
/** Confirmed read envelope for APIs/reconciliation; original deployment evidence
 * stays separate. Ledger/evidence provenance is supplied by the trusted reader. */
export const ConfirmedNodeConfigurationSchema = z
  .object({
    version: z.literal(1),
    nodeId: PolicyIdSchema,
    contractAddress: ContractAddressSchema,
    confirmedLedger: z.number().int().min(1).max(4_294_967_295),
    revision: ConfigurationRevisionSchema,
    policy: NodeFieldPolicySchema,
    configuration: z.discriminatedUnion("kind", [
      StoredPayConfigurationSchema,
      StoredSplitConfigurationSchema,
    ]),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    const { policy, configuration } = snapshot;
    if (snapshot.nodeId !== policy.nodeId || policy.kind !== configuration.kind)
      ctx.addIssue({
        code: "custom",
        message: "Configuration must match its immutable policy and node",
      });
    if (
      policy.kind === "pay" &&
      configuration.kind === "pay" &&
      (configuration.recipient !== undefined) !== (policy.recipient !== "execution")
    )
      ctx.addIssue({ code: "custom", message: "Stored recipient presence must match policy" });
    if (
      policy.kind === "pay" &&
      configuration.kind === "pay" &&
      configuration.payoutValue.kind === "full" &&
      policy.payoutValue !== "constant"
    )
      ctx.addIssue({ code: "custom", message: "Full-amount Pay has no stored mutable value" });
    if (policy.kind !== "split" || configuration.kind !== "split") return;
    const rows = [...configuration.configuredRows, ...configuration.additionalRecipients];
    if (
      (rows.length < 1 && policy.additionalRecipients !== "execution") ||
      rows.length > REUSABLE_LIMITS.recipients ||
      new Set(rows.map((r) => r.rowId)).size !== rows.length ||
      new Set(rows.flatMap((r) => (r.recipient === undefined ? [] : [r.recipient]))).size !==
        rows.filter((r) => r.recipient !== undefined).length
    )
      ctx.addIssue({ code: "custom", message: "Invalid split recipient roster" });
    if (
      configuration.configuredRows.length !== policy.rows.length ||
      policy.rows.some((r, i) => r.rowId !== configuration.configuredRows[i]?.rowId)
    )
      ctx.addIssue({ code: "custom", message: "Configured row identity/order cannot change" });
    if (policy.additionalRecipients !== "mutable" && configuration.additionalRecipients.length > 0)
      ctx.addIssue({ code: "custom", message: "Additional recipients were not declared" });
    for (const [index, row] of configuration.configuredRows.entries()) {
      const declared = policy.rows[index];
      if (
        declared &&
        ((row.recipient !== undefined) !== (declared.recipient !== "execution") ||
          (row.allocation !== undefined) !== (declared.allocation !== "execution"))
      )
        ctx.addIssue({ code: "custom", message: "Stored row presence must match field policy" });
    }
    if (rows.some((r) => r.allocation && r.allocation.kind !== policy.allocationMode))
      ctx.addIssue({ code: "custom", message: "Allocation mode cannot change" });
    if (
      policy.allocationMode === "percentage" &&
      policy.additionalRecipients !== "execution" &&
      rows.every((r) => r.allocation !== undefined) &&
      rows.reduce(
        (sum, r) => sum + (r.allocation?.kind === "percentage" ? r.allocation.bps : 0),
        0,
      ) !== 10_000
    )
      ctx.addIssue({ code: "custom", message: "Percentage allocations must total 10000 bps" });
  });
export type ConfirmedNodeConfiguration = z.infer<typeof ConfirmedNodeConfigurationSchema>;
