import { z } from "zod";
import {
  ConditionalExecutePrepareSchema,
  ConditionalExecutePreparedSchema,
} from "@/lib/api/v1/conditional-execution-schema";
import { NonnegativeStroopsSchema } from "@/lib/flows/conditional-v2";
import {
  HostedOwnershipChallengeSchema,
  HostedReceiptSchema,
  HostedRecoveryKeySchema,
  HostedReviewRowSchema,
} from "./schema";
/** Separate wire generation; schema acceptance never grants deployed capability. */
export const ConditionalHostedOwnershipRequestSchema = z
  .object({ recoveryKey: HostedRecoveryKeySchema, payment: ConditionalExecutePrepareSchema })
  .strict();
export type ConditionalHostedOwnershipRequest = z.infer<
  typeof ConditionalHostedOwnershipRequestSchema
>;
export const ConditionalHostedPrepareSchema = ConditionalHostedOwnershipRequestSchema.extend({
  ownershipProofXdr: z.string().min(10).max(4096).optional(),
}).strict();
export type ConditionalHostedPrepare = z.infer<typeof ConditionalHostedPrepareSchema>;
export const ConditionalHostedOwnershipChallengeSchema = HostedOwnershipChallengeSchema.extend({
  version: z.literal(2),
}).strict();
export type ConditionalHostedOwnershipChallenge = z.infer<
  typeof ConditionalHostedOwnershipChallengeSchema
>;
export const ConditionalHostedReceiptSchema = HostedReceiptSchema.extend({
  version: z.literal(2),
}).strict();
export type ConditionalHostedReceipt = z.infer<typeof ConditionalHostedReceiptSchema>;
export const ConditionalHostedReviewRowSchema = HostedReviewRowSchema.extend({
  kind: z.enum(["pay", "split", "return_to_owner"]),
  amountStroops: NonnegativeStroopsSchema,
}).strict();
export type ConditionalHostedReviewRow = z.infer<typeof ConditionalHostedReviewRowSchema>;
export const ConditionalHostedPreparedSchema = z
  .object({
    version: z.literal(2),
    prepared: ConditionalExecutePreparedSchema,
    feeStroops: NonnegativeStroopsSchema,
    rows: z.array(ConditionalHostedReviewRowSchema).max(56),
    refundStroops: NonnegativeStroopsSchema,
    accumulation: z.boolean(),
  })
  .strict();
export type ConditionalHostedPrepared = z.infer<typeof ConditionalHostedPreparedSchema>;
export const ConditionalHostedSubmittedSchema = z
  .object({
    version: z.literal(2),
    txHash: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(["SUCCESS", "FAILED", "PENDING", "UNKNOWN", "REJECTED"]),
  })
  .strict();
export type ConditionalHostedSubmitted = z.infer<typeof ConditionalHostedSubmittedSchema>;
/** Same physical key as v1; no transaction bytes or private wallet material. */
export const ConditionalHostedBrowserRecoverySchema = z
  .object({
    version: z.literal(2),
    deploymentId: z.uuid(),
    network: z.enum(["testnet", "mainnet"]),
    recoveryKey: HostedRecoveryKeySchema,
    request: ConditionalExecutePrepareSchema,
    phase: z.enum(["ownership", "preparing", "prepared", "signing", "submitted"]),
    intent: z.uuid().optional(),
    txHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    attemptId: z.uuid().optional(),
  })
  .strict()
  .superRefine((record, ctx) => {
    if ((record.intent === undefined) !== (record.txHash === undefined))
      ctx.addIssue({ code: "custom", message: "Original intent and hash must remain together" });
    if (["prepared", "signing", "submitted"].includes(record.phase) && !record.intent)
      ctx.addIssue({
        code: "custom",
        message: "This phase requires the original payment identity",
      });
    if (record.phase === "ownership" && (record.intent || record.txHash || record.attemptId))
      ctx.addIssue({
        code: "custom",
        message: "Ownership-only phase cannot replace admitted evidence",
      });
    if (record.attemptId && record.phase !== "signing" && record.phase !== "submitted")
      ctx.addIssue({
        code: "custom",
        message: "Signing uncertainty must retain its signing phase",
      });
  });
export type ConditionalHostedBrowserRecovery = z.infer<
  typeof ConditionalHostedBrowserRecoverySchema
>;
