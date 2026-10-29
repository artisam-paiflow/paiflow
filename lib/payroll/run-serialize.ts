import { z } from "zod";
import { integerNumber } from "@/lib/validation/number";

/**
 * Serialization helpers + Zod contracts for the pay-run list/detail endpoints
 * consumed by the external payroll app (`paiflow-payroll`).
 *
 * `PayrollPayout` has no persisted status/completedAt of its own, so per-payout
 * status is derived from its charge transaction hash.
 */

export type PayoutStatus = "PENDING" | "COMPLETED";

/** A crypto payout completes with its recorded on-chain charge. */
export function derivePayoutStatus(txHash: string | null): PayoutStatus {
  return txHash ? "COMPLETED" : "PENDING";
}

export const RunListItemSchema = z.object({
  id: z.string(),
  status: z.enum(["PENDING", "CHARGED", "FAILED", "CANCELLED"]),
  totalStroops: z.string().nullable(),
  triggeredAt: z.string().nullable(),
  chargedAt: z.string().nullable(),
  txHash: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  payoutCount: integerNumber(),
  completedPayoutCount: integerNumber(),
});

export const RunListResponseSchema = z.object({
  data: z.array(RunListItemSchema),
  nextCursor: z.string().nullable(),
});

export const RunPayoutSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  employeeLabel: z.string(),
  amountStroops: z.string(),
  mode: z.literal("CRYPTO"),
  status: z.enum(["PENDING", "SENT", "COMPLETED", "FAILED"]),
  txHash: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export const RunDetailResponseSchema = z.object({
  id: z.string(),
  status: z.enum(["PENDING", "CHARGED", "FAILED", "CANCELLED"]),
  totalStroops: z.string().nullable(),
  triggeredAt: z.string().nullable(),
  chargedAt: z.string().nullable(),
  txHash: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  payouts: z.array(RunPayoutSchema),
});

export type RunListResponse = z.infer<typeof RunListResponseSchema>;
export type RunDetailResponse = z.infer<typeof RunDetailResponseSchema>;

/** Minimal shape needed to derive a payout's status. */
export type PayoutStatusInput = { txHash: string | null };
export type PayoutForSerialize = PayoutStatusInput & {
  id: string;
  employeeId: string;
  amountStroops: string;
  employee: { label: string | null; address: string };
};

export function serializePayout(payout: PayoutForSerialize): z.infer<typeof RunPayoutSchema> {
  return {
    id: payout.id,
    employeeId: payout.employeeId,
    employeeLabel: payout.employee.label ?? payout.employee.address,
    amountStroops: payout.amountStroops,
    mode: "CRYPTO",
    status: derivePayoutStatus(payout.txHash),
    txHash: payout.txHash,
    completedAt: null,
  };
}

/** Count payouts whose derived status is COMPLETED. */
export function countCompletedPayouts(payouts: PayoutStatusInput[]): number {
  return payouts.filter((p) => derivePayoutStatus(p.txHash) === "COMPLETED").length;
}
