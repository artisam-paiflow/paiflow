import { z } from "zod";
import { integerNumber } from "@/lib/validation/number";

export const RetireDeploymentSchema = z
  .object({
    confirmation: z.literal("Permanently retire deployment"),
    irreversible: z.literal(true),
    onChainResponsibility: z.literal(true),
  })
  .strict();
export type RetireDeployment = z.infer<typeof RetireDeploymentSchema>;

export const DeleteFlowSchema = z
  .object({ confirmation: z.literal("Permanently delete flow") })
  .strict();
export type DeleteFlow = z.infer<typeof DeleteFlowSchema>;

export const SettlementVerificationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("fence-work"),
      id: z.string().guid({ error: "Invalid uuid" }),
      evidence: z.string().trim().min(20).max(2000),
      confirmation: z.literal("Verified worker stopped"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("transaction"),
      txHash: z.string().regex(/^[0-9a-f]{64}$/),
      outcome: z.enum(["SUCCESS", "FAILED"]),
      ledger: integerNumber().positive(),
      evidence: z.string().trim().min(20).max(2000),
      confirmation: z.literal("Verified no remaining obligation"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("streamer"),
      id: z.string().guid({ error: "Invalid uuid" }),
      outcome: z.enum(["CLAIMED", "SKIPPED"]),
      evidence: z.string().trim().min(20).max(2000),
      confirmation: z.literal("Verified no remaining obligation"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("events"),
      cutoffLedger: integerNumber().nonnegative(),
      evidence: z.string().trim().min(20).max(2000),
      confirmation: z.literal("Verified no remaining obligation"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("work"),
      id: z.string().guid({ error: "Invalid uuid" }),
      evidence: z.string().trim().min(20).max(2000),
      confirmation: z.literal("Verified no remaining obligation"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("offramp"),
      id: z.string().guid({ error: "Invalid uuid" }),
      evidence: z.string().trim().min(20).max(2000),
      confirmation: z.literal("Verified no remaining obligation"),
    })
    .strict(),
]);
export type SettlementVerification = z.infer<typeof SettlementVerificationSchema>;
