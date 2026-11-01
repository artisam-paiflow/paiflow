import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { AssetSchema, ConditionLogic } from "@/lib/flows/schema";
import { PipelineImplementationSchema } from "@/lib/flows/implementation";
import {
  AdditionalRecipientSchema,
  PayFieldPolicySchema,
  SplitFieldPolicySchema,
} from "@/lib/flows/field-policies";

// Validate recorded compiler output, without rerunning a time-sensitive compiler.
const amount = z
  .string()
  .regex(/^\d+$/)
  .refine(
    (v) => /^\d+$/.test(v) && v.replace(/^0+/, "").length <= 39 && BigInt(v) <= 2n ** 127n - 1n,
  );
const id = z.string().min(1).max(128);
const addressOrNode = z.string().max(128);
const next = z.array(id).max(40);
const seconds = z.number().int().min(0).max(253402300799);
const bps = z.number().int().min(0).max(10_000);
const asset = { asset: AssetSchema };
const recipient = z.object({ rowId: id.optional(), address: addressOrNode, bps, amount }).strict();
const recipients = z.array(recipient).max(20);
const schedule = { startTs: seconds, endTs: seconds, intervalSeconds: seconds.min(1) };
const params = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("deposit_trigger"),
      ...asset,
      nextStepNodeIds: next,
      executionNodeId: id.optional(),
      minAmountStroops: amount.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("splitter"),
      ...asset,
      recipients,
      minAmountStroops: amount,
      nextStepNodeIds: next,
      fieldPolicy: SplitFieldPolicySchema.optional(),
      initialAdditionalRecipients: z.array(AdditionalRecipientSchema).max(20).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("streamer"),
      ...asset,
      recipients,
      amountPerIntervalStroops: amount,
      ...schedule,
      pauseAllowed: z.boolean(),
      retrieveAllowed: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("conditional"),
      ...asset,
      recipients,
      amountStroops: amount,
      condition: ConditionLogic.shape.config.nullable(),
      nextStepNodeIds: next,
    })
    .strict(),
  z
    .object({
      kind: z.literal("router"),
      ...asset,
      threshold: amount,
      pathANodeIds: next,
      pathBNodeIds: next,
    })
    .strict(),
  z
    .object({
      kind: z.literal("timelock"),
      ...asset,
      unlockTime: seconds,
      mode: z.enum(["after", "before"]),
      nextStepNodeIds: next,
      relayer: addressOrNode.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("timelock_branch"),
      ...asset,
      unlockTime: seconds,
      beforeNodeIds: next,
      afterNodeIds: next,
      relayer: addressOrNode.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("webhook_trigger"),
      ...asset,
      relayer: addressOrNode,
      nextStepNodeIds: next,
    })
    .strict(),
  z
    .object({
      kind: z.literal("subscription_trigger"),
      ...asset,
      subscriber: addressOrNode,
      amountPerPeriodStroops: amount,
      relayer: addressOrNode.optional(),
      ...schedule,
      nextStepNodeIds: next,
    })
    .strict(),
  z
    .object({
      kind: z.literal("oracle_trigger"),
      ...asset,
      threshold: amount,
      nextStepNodeIds: next,
    })
    .strict(),
  z
    .object({
      kind: z.literal("multisig"),
      ...asset,
      signers: z
        .array(z.object({ address: addressOrNode, bps }).strict())
        .min(1)
        .max(20),
      threshold: z.number().int().positive(),
      nextStepNodeIds: next,
    })
    .strict(),
  z
    .object({
      kind: z.literal("swapper"),
      assetIn: AssetSchema,
      assetOut: AssetSchema,
      slippageBps: bps,
      deadlineSecs: seconds.min(1),
      router: addressOrNode.optional(),
      nextStepNodeIds: next,
    })
    .strict(),
  z
    .object({ kind: z.literal("yield"), ...asset, vault: addressOrNode, nextStepNodeIds: next })
    .strict(),
  z
    .object({
      kind: z.literal("payer"),
      ...asset,
      recipient: addressOrNode,
      amountStroops: amount,
      mode: z.enum(["fixed", "percentage"]),
      percentageBps: bps.optional(),
      nextStepNodeIds: next,
      fieldPolicy: PayFieldPolicySchema.optional(),
      fullAmount: z.boolean().optional(),
    })
    .strict(),
]);
const kinds = {
  deposit_trigger: "DEPOSIT_TRIGGER",
  splitter: "SPLITTER",
  streamer: "STREAMER",
  conditional: "CONDITIONAL",
  router: "ROUTER",
  timelock: "TIMELOCK",
  timelock_branch: "TIMELOCK_BRANCH",
  webhook_trigger: "WEBHOOK",
  subscription_trigger: "SUBSCRIPTION",
  oracle_trigger: "ORACLE",
  multisig: "MULTISIG",
  swapper: "SWAPPER",
  yield: "YIELD",
  payer: "PAYER",
} as const;
const node = z
  .object({
    nodeId: id,
    templateKind: z.enum(Object.values(kinds)),
    implementation: PipelineImplementationSchema,
    params,
  })
  .strict()
  .superRefine((n, ctx) => {
    if (kinds[n.params.kind] !== n.templateKind)
      ctx.addIssue({ code: "custom", message: "Compiled kind and artifact kind differ" });
    if (
      (n.params.kind === "streamer" || n.params.kind === "subscription_trigger") &&
      n.params.endTs < n.params.startTs
    )
      ctx.addIssue({ code: "custom", message: "Invalid recorded agreement window" });
  });
export const InstanceCompiledTermsSchema = z
  .array(node)
  .min(1)
  .max(40)
  .superRefine((nodes, ctx) => {
    if (new Set(nodes.map((n) => n.nodeId)).size !== nodes.length)
      ctx.addIssue({ code: "custom", message: "Duplicate compiled node identities" });
  });
export type InstanceCompiledTerms = z.infer<typeof InstanceCompiledTermsSchema>;
/** The prepared review must include build-time bindings, not merely compiler output. */
export const InstancePreparedTermsSchema = InstanceCompiledTermsSchema.superRefine((nodes, ctx) => {
  for (const node of nodes) {
    const p = node.params;
    if (p.kind === "swapper" && (!p.router || !StrKey.isValidContract(p.router)))
      ctx.addIssue({ code: "custom", message: "Prepared swap router evidence is required" });
    if (
      (p.kind === "timelock" ||
        p.kind === "timelock_branch" ||
        p.kind === "subscription_trigger") &&
      (!p.relayer ||
        (!StrKey.isValidEd25519PublicKey(p.relayer) && !StrKey.isValidContract(p.relayer)))
    )
      ctx.addIssue({ code: "custom", message: "Prepared relayer authority evidence is required" });
  }
});
