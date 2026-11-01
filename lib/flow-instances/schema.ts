import { z } from "zod";
import { CreationBindingsSchema, WalletAddressSchema } from "@/lib/flows/field-policies";
import { TemplateArtifactsSchema } from "@/lib/flow-templates/schema";

export const InstancePrepareSchema = z
  .object({
    sourceAccount: WalletAddressSchema,
    bindings: CreationBindingsSchema,
    idempotencyKey: z
      .string()
      .min(16)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();
export type InstancePrepare = z.infer<typeof InstancePrepareSchema>;
export const InstanceSubmitSchema = z
  .object({ signedXdr: z.string().min(10).max(200_000) })
  .strict();
export type InstanceSubmit = z.infer<typeof InstanceSubmitSchema>;
export const InstanceReconcileSchema = z.object({}).strict();
export type InstanceReconcile = z.infer<typeof InstanceReconcileSchema>;
export const InstanceListQuerySchema = z
  .object({
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type InstanceListQuery = z.infer<typeof InstanceListQuerySchema>;
export const InstanceSnapshotSchema = z
  .object({
    version: z.literal(1),
    templateId: z.uuid(),
    templateVersionId: z.uuid(),
    templateVersion: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    ownerId: z.uuid(),
    sourceAccount: WalletAddressSchema,
    network: z.enum(["testnet", "mainnet"]),
    bindings: CreationBindingsSchema,
    artifacts: TemplateArtifactsSchema,
    maxTime: z.number().int().positive(),
  })
  .strict();
export type InstanceSnapshot = z.infer<typeof InstanceSnapshotSchema>;
export const InstanceStateSchema = z
  .object({
    deploymentId: z.uuid(),
    templateId: z.uuid(),
    templateVersionId: z.uuid(),
    network: z.enum(["testnet", "mainnet"]),
    sourceAccount: WalletAddressSchema,
    status: z.enum(["DRAFT", "BUILDING", "PENDING_SIGNATURE", "SUBMITTED", "CONFIRMED", "FAILED"]),
    serviceState: z.enum(["ACTIVE", "RETIRING", "RETIRED"]),
    txHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    contractAddress: z.string().nullable(),
    pipeline: z.array(
      z
        .object({ nodeId: z.string(), contractAddress: z.string(), templateKind: z.string() })
        .strict(),
    ),
    prepared: z
      .object({
        xdr: z.string().min(10).max(200_000),
        networkPassphrase: z.string().min(1),
        txHash: z.string().regex(/^[a-f0-9]{64}$/),
        expiresAt: z.iso.datetime(),
        feeStroops: z.string().regex(/^\d+$/),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type InstanceState = z.infer<typeof InstanceStateSchema>;
export const InstanceListSchema = z
  .object({ items: z.array(InstanceStateSchema), nextCursor: z.uuid().nullable() })
  .strict();
export type InstanceList = z.infer<typeof InstanceListSchema>;
