import { z } from "zod";
import { ExecutePrepareSchema, ExecutePreparedSchema } from "@/lib/api/v1/schema";
import {
  ExecutionIntentSchema,
  WalletAddressSchema,
  PolicyIdSchema,
} from "@/lib/flows/field-policies";

export const HostedVisibilitySchema = z.object({ enabled: z.boolean() }).strict();
export type HostedVisibility = z.infer<typeof HostedVisibilitySchema>;
/** Random browser capability, unrelated to wallet signing or API access. */
export const HostedRecoveryKeySchema = z.string().regex(/^[a-f0-9]{64}$/);
export type HostedRecoveryKey = z.infer<typeof HostedRecoveryKeySchema>;
export const HostedOwnershipRequestSchema = z
  .object({
    recoveryKey: HostedRecoveryKeySchema,
    payment: ExecutePrepareSchema,
  })
  .strict();
export type HostedOwnershipRequest = z.infer<typeof HostedOwnershipRequestSchema>;
export const HostedPrepareSchema = HostedOwnershipRequestSchema.extend({
  /** Sign-only proof; omitted only when recovering an existing exact request. */
  ownershipProofXdr: z.string().min(10).max(4096).optional(),
}).strict();
export type HostedPrepare = z.infer<typeof HostedPrepareSchema>;
export const HostedOwnershipChallengeSchema = z
  .object({
    xdr: z.string().min(10).max(4096),
    bindingDigest: z.string().regex(/^[a-f0-9]{64}$/),
    network: z.enum(["testnet", "mainnet"]),
    networkPassphrase: z.string().min(1),
  })
  .strict();
export type HostedOwnershipChallenge = z.infer<typeof HostedOwnershipChallengeSchema>;
export const HostedReceiptRequestSchema = z
  .object({ recoveryKey: HostedRecoveryKeySchema })
  .strict();
export type HostedReceiptRequest = z.infer<typeof HostedReceiptRequestSchema>;
export const HostedSubmitSchema = HostedReceiptRequestSchema.extend({
  intent: z.uuid(),
  signedXdr: z.string().min(10).max(200_000),
}).strict();
export type HostedSubmit = z.infer<typeof HostedSubmitSchema>;
export const HostedReceiptSchema = z
  .object({
    intent: z.uuid(),
    txHash: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum(["PREPARED", "SUBMITTING", "SUCCESS", "FAILED", "EXPIRED"]),
    network: z.enum(["testnet", "mainnet"]),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export type HostedReceipt = z.infer<typeof HostedReceiptSchema>;
export const HostedReviewRowSchema = z
  .object({
    nodeId: PolicyIdSchema,
    rowId: PolicyIdSchema,
    recipient: WalletAddressSchema,
    amountStroops: z.string().regex(/^(0|[1-9]\d*)$/),
    allocation: z.string(),
    recipientSource: z.enum(["constant", "execution", "mutable"]),
    allocationSource: z.enum(["constant", "execution", "mutable"]),
  })
  .strict();
export type HostedReviewRow = z.infer<typeof HostedReviewRowSchema>;
export const HostedPreparedSchema = z
  .object({
    prepared: ExecutePreparedSchema.extend({
      intent: z.uuid(),
      txHash: z.string().regex(/^[a-f0-9]{64}$/),
      walletAddress: WalletAddressSchema,
      execution: ExecutionIntentSchema,
      expiresAt: z.iso.datetime(),
    }),
    feeStroops: z.string().regex(/^\d+$/),
    rows: z.array(HostedReviewRowSchema),
    refundStroops: z.string().regex(/^\d+$/),
    accumulation: z.boolean(),
  })
  .strict();
export type HostedPrepared = z.infer<typeof HostedPreparedSchema>;
