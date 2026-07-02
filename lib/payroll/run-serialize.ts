import { z } from "zod";
import type { EmployeePayoutMode, OffRampPayoutJobStatus } from "@prisma/client";

/**
 * Serialization helpers + Zod contracts for the pay-run list/detail endpoints
 * consumed by the external payroll app (`paiflow-payroll`).
 *
 * `PayrollPayout` has no persisted status/completedAt of its own, so per-payout
 * status is derived from its charge tx hash and its (optional) off-ramp job.
 */

export type PayoutStatus = "PENDING" | "SENT" | "COMPLETED" | "FAILED";

const OFFRAMP_TERMINAL_FAIL: ReadonlySet<OffRampPayoutJobStatus> = new Set(["FAILED", "CANCELLED"]);

/**
 * Derive a payout's status from its on-chain charge tx and off-ramp job.
 *
 * - No charge tx yet → PENDING.
 * - Off-ramp job present → mirror its lifecycle (crypto is sent, fiat pending).
 * - No off-ramp job (pure crypto) → COMPLETED once the charge tx exists.
 */
export function derivePayoutStatus(
  txHash: string | null,
  offRampJobStatus: OffRampPayoutJobStatus | null,
): PayoutStatus {
  if (!txHash) return "PENDING";
  if (offRampJobStatus === null) return "COMPLETED";
  if (offRampJobStatus === "COMPLETED") return "COMPLETED";
  if (OFFRAMP_TERMINAL_FAIL.has(offRampJobStatus)) return "FAILED";
  return "SENT";
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
  payoutCount: z.number().int(),
  completedPayoutCount: z.number().int(),
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
  mode: z.enum(["CRYPTO", "FIAT"]),
  status: z.enum(["PENDING", "SENT", "COMPLETED", "FAILED"]),
  txHash: z.string().nullable(),
  completedAt: z.string().nullable(),
  offRampJobStatus: z
    .enum(["PENDING", "RUNNING", "QUOTED", "INITIATED", "COMPLETED", "FAILED", "CANCELLED"])
    .nullable(),
  offRampJobError: z.string().nullable(),
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

/** Minimal shape needed to serialize a payout row. */
export type PayoutForSerialize = {
  id: string;
  employeeId: string;
  amountStroops: string;
  txHash: string | null;
  employee: { label: string | null; address: string; payoutMode: EmployeePayoutMode };
  offRampJobs: {
    status: OffRampPayoutJobStatus;
    lastError: string | null;
    completedAt: Date | null;
  }[];
};

export function serializePayout(payout: PayoutForSerialize): z.infer<typeof RunPayoutSchema> {
  const job = payout.offRampJobs[0] ?? null;
  return {
    id: payout.id,
    employeeId: payout.employeeId,
    employeeLabel: payout.employee.label ?? payout.employee.address,
    amountStroops: payout.amountStroops,
    mode: payout.employee.payoutMode,
    status: derivePayoutStatus(payout.txHash, job?.status ?? null),
    txHash: payout.txHash,
    completedAt: job?.completedAt?.toISOString() ?? null,
    offRampJobStatus: job?.status ?? null,
    offRampJobError: job?.lastError ?? null,
  };
}

/** Count payouts whose derived status is COMPLETED. */
export function countCompletedPayouts(payouts: PayoutForSerialize[]): number {
  return payouts.reduce(
    (n, p) =>
      n + (derivePayoutStatus(p.txHash, p.offRampJobs[0]?.status ?? null) === "COMPLETED" ? 1 : 0),
    0,
  );
}
