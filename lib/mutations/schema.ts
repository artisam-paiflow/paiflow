import { z } from "zod";
import {
  ContractAddressSchema,
  ConfirmedNodeConfigurationSchema,
  PolicyIdSchema,
  ConfigurationRevisionSchema,
  ExecutionNodeBindingSchema,
  MutationArgumentsSchema,
  WalletAddressSchema,
} from "@/lib/flows/field-policies";
import { ExecutionDiscoverySchema } from "@/lib/api/v1/execution-schema";
import { TransactionStatusSchema } from "@/lib/api/v1/schema";
import { ExecutionArtifactsSchema } from "@/lib/api/v1/execution-schema";

export const MutationPrepareSchema = z
  .object({
    admin: WalletAddressSchema,
    arguments: MutationArgumentsSchema,
  })
  .strict();
export type MutationPrepare = z.infer<typeof MutationPrepareSchema>;
export const MutationPreparationRefusalSchema = z
  .object({
    version: z.literal(1),
    outcome: z.literal("NOT_ADMITTED"),
    refusalId: z.uuid(),
    deploymentId: z.uuid(),
    network: z.enum(["testnet", "mainnet"]),
    admin: WalletAddressSchema,
    idempotencyKeyHash: z.string().regex(/^[a-f0-9]{64}$/),
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    refusedAt: z.iso.datetime(),
    reasonCode: z.enum(["VALIDATION", "CONFLICT", "UPSTREAM_RPC", "INSUFFICIENT_FUNDS"]),
  })
  .strict();
export type MutationPreparationRefusal = z.infer<typeof MutationPreparationRefusalSchema>;
export const MutationIntentSchema = z
  .object({
    version: z.literal(1),
    deploymentId: z.uuid(),
    network: z.enum(["testnet", "mainnet"]),
    admin: WalletAddressSchema,
    rootContract: ContractAddressSchema,
    nodes: z.array(ExecutionNodeBindingSchema).min(2).max(40),
    arguments: MutationArgumentsSchema,
    artifacts: ExecutionArtifactsSchema,
  })
  .strict()
  .superRefine((intent, ctx) => {
    if (
      intent.nodes[0]?.contractAddress !== intent.rootContract ||
      new Set(intent.nodes.map((n) => n.nodeId)).size !== intent.nodes.length ||
      new Set(intent.nodes.map((n) => n.contractAddress)).size !== intent.nodes.length ||
      intent.artifacts.length !== intent.nodes.length ||
      intent.artifacts.some(
        (a, i) =>
          a.nodeId !== intent.nodes[i]?.nodeId ||
          a.contractAddress !== intent.nodes[i]?.contractAddress,
      ) ||
      intent.arguments.changes.some(
        (c) =>
          !intent.nodes.some(
            (n) => n.nodeId === c.nodeId && n.expectedRevision === c.expectedRevision,
          ),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Mutation must bind the complete ordered path and each reviewed revision",
      });
  });
export type MutationIntent = z.infer<typeof MutationIntentSchema>;
export const MutationSubmitSchema = z
  .object({ intent: z.uuid(), signedXdr: z.string().min(1).max(200000) })
  .strict();
export const MutationReconcileSchema = z.object({ intent: z.uuid() }).strict();
export const ConfigurationHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.uuid().optional(),
  })
  .strict();

export const MutationStateSchema = ExecutionDiscoverySchema.options[1].safeExtend({
  admin: WalletAddressSchema,
  mutationSupported: z.literal(true),
  obligations: z
    .array(
      z
        .object({
          nodeId: PolicyIdSchema,
          obligationsStroops: z.string().regex(/^(0|[1-9]\d{0,38})$/),
        })
        .strict(),
    )
    .max(39),
});
export const MutationPreparedSchema = z
  .object({
    intent: z.uuid(),
    txHash: z.string().regex(/^[a-f0-9]{64}$/),
    walletAddress: WalletAddressSchema,
    xdr: z.string().min(1).max(200000),
    expiresAt: z.iso.datetime(),
    network: z.enum(["testnet", "mainnet"]),
    networkPassphrase: z.string().min(1),
    feeStroops: z.string().regex(/^[1-9]\d*$/),
    mutation: MutationIntentSchema,
  })
  .strict();
export const MutationReconciledSchema = z
  .object({
    intent: z.uuid(),
    state: z.enum(["PREPARED", "SUBMITTING", "SUCCESS", "FAILED", "EXPIRED"]),
    transaction: TransactionStatusSchema,
  })
  .strict();
export const ConfigurationHistorySchema = z
  .object({
    deploymentId: z.uuid(),
    network: z.enum(["testnet", "mainnet"]),
    coverage: z.literal("observed-revisions-only"),
    historyComplete: z.literal(false),
    revisionCoverage: z
      .array(
        z
          .object({
            nodeId: PolicyIdSchema,
            highestObservedRevision: ConfigurationRevisionSchema,
            observedRevisionCount: z.string().regex(/^[1-9]\d*$/),
            missingRevisionCount: z.string().regex(/^(0|[1-9]\d*)$/),
          })
          .strict(),
      )
      .max(39),
    items: z
      .array(
        z
          .object({
            id: z.uuid(),
            configuration: ConfirmedNodeConfigurationSchema,
            observedLedger: z.number().int().positive(),
            eventLedger: z.number().int().positive().nullable(),
            eventId: z.string().nullable(),
            txHash: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .nullable(),
          })
          .strict(),
      )
      .max(100),
    nextCursor: z.uuid().nullable(),
  })
  .strict();
