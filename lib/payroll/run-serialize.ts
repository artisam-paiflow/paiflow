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
 * Derive a payout's status from its payout mode, on-chain charge tx, and
 * off-ramp job.
 *
 * - No charge tx yet → PENDING.
 * - Off-ramp job present → mirror its lifecycle (crypto is sent, fiat pending).
 * - No off-ramp job:
 *   - CRYPTO → COMPLETED (the charge tx is the whole payout).
 *   - FIAT → SENT, not COMPLETED. A FIAT payout can be charged on-chain but
 *     have no off-ramp job yet — job creation is best-effort and swallows
 *     failures, and a deployment may have `offRampEnabled = false`. The fiat
 *     leg is what completes the payout, so without a completed job it is still
 *     in flight, never done.
 */
export function derivePayoutStatus(
  mode: EmployeePayoutMode,
  txHash: string | null,
  offRampJobStatus: OffRampPayoutJobStatus | null,
): PayoutStatus {
  if (!txHash) return "PENDING";
  if (offRampJobStatus === null) return mode === "FIAT" ? "SENT" : "COMPLETED";
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

/** Minimal shape needed to derive a payout's status. */
export type PayoutStatusInput = {
  txHash: string | null;
  employee: { payoutMode: EmployeePayoutMode };
  offRampJobs: { status: OffRampPayoutJobStatus }[];
};

/** Minimal shape needed to serialize a payout row. */
export type PayoutForSerialize = PayoutStatusInput & {
  id: string;
  employeeId: string;
  amountStroops: string;
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
    status: derivePayoutStatus(payout.employee.payoutMode, payout.txHash, job?.status ?? null),
    txHash: payout.txHash,
    completedAt: job?.completedAt?.toISOString() ?? null,
    offRampJobStatus: job?.status ?? null,
    offRampJobError: job?.lastError ?? null,
  };
}

/** Count payouts whose derived status is COMPLETED. */
export function countCompletedPayouts(payouts: PayoutStatusInput[]): number {
  return payouts.reduce(
    (n, p) =>
      n +
      (derivePayoutStatus(p.employee.payoutMode, p.txHash, p.offRampJobs[0]?.status ?? null) ===
      "COMPLETED"
        ? 1
        : 0),
    0,
  );
}
