import { z } from "zod";
import type { OffRampPayoutJobStatus, PayrollRunStatus } from "@prisma/client";

/**
 * Event-feed synthesis + Zod contracts for the payroll live-feed endpoints
 * consumed by the external payroll app (`paiflow-payroll`).
 *
 * There is no dedicated event-log table: payroll transitions are not recorded
 * as append-only rows. Instead we *synthesize* a merged timeline from the
 * current state of `PayrollRun`, `PayrollPayout`, and `OffRampPayoutJob` rows.
 *
 * Each synthesized event has a stable `id` of the form `${rowId}:${kind}` so
 * that repeated polls return the same id for the same logical event, and so
 * cursor pagination is deterministic. Because most rows carry only a single
 * mutable `status` column (no per-transition timestamps), off-ramp jobs emit
 * only the event for their *current* terminal status; the best available
 * timestamp is used for `occurredAt`.
 */

export const EVENT_KINDS = [
  "PAYROLL_RUN_CREATED",
  "PAYROLL_RUN_CHARGED",
  "PAYROLL_RUN_FAILED",
  "PAYROLL_RUN_CANCELLED",
  "PAYOUT_CREATED",
  "PAYOUT_SENT",
  "PAYOUT_COMPLETED",
  "PAYOUT_FAILED",
  "OFFRAMP_QUOTED",
  "OFFRAMP_INITIATED",
  "OFFRAMP_COMPLETED",
  "OFFRAMP_FAILED",
  "OFFRAMP_CANCELLED",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

export const PayrollEventSchema = z.object({
  id: z.string(),
  kind: z.enum(EVENT_KINDS),
  payrollRunId: z.string().nullable(),
  payoutId: z.string().nullable(),
  employeeId: z.string().nullable(),
  employeeLabel: z.string().nullable(),
  amountStroops: z.string().nullable(),
  txHash: z.string().nullable(),
  message: z.string().nullable(),
  occurredAt: z.string(),
});

export const FeedResponseSchema = z.object({
  data: z.array(PayrollEventSchema),
  nextCursor: z.string().nullable(),
});

export const FeedQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type PayrollEventOut = z.infer<typeof PayrollEventSchema>;
export type FeedResponse = z.infer<typeof FeedResponseSchema>;

/** Internal event carrying a `Date` for sorting before serialization. */
export type PayrollEvent = Omit<PayrollEventOut, "occurredAt"> & { occurredAt: Date };

/* -------------------------------------------------------------------------- */
/* Row shapes needed to synthesize events                                     */
/* -------------------------------------------------------------------------- */

export type PayoutForEvents = {
  id: string;
  employeeId: string;
  amountStroops: string;
  txHash: string | null;
  createdAt: Date;
  employee: { label: string | null; address: string };
};

export type RunForEvents = {
  id: string;
  status: PayrollRunStatus;
  totalStroops: string;
  txHash: string | null;
  chargedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastError: string | null;
  payouts: PayoutForEvents[];
};

export type OffRampJobForEvents = {
  id: string;
  status: OffRampPayoutJobStatus;
  amountStroops: string;
  payrollRunId: string | null;
  employeeId: string | null;
  payrollPayoutId: string | null;
  completedAt: Date | null;
  updatedAt: Date;
  lastError: string | null;
  providerRef: string | null;
  employee: { label: string | null; address: string } | null;
};

function employeeLabel(employee: { label: string | null; address: string } | null): string | null {
  if (!employee) return null;
  return employee.label ?? employee.address;
}

/* -------------------------------------------------------------------------- */
/* Synthesis                                                                  */
/* -------------------------------------------------------------------------- */

/** Events for a single payroll run (run-level, no employee attribution). */
function runEvents(run: RunForEvents): PayrollEvent[] {
  const base = {
    payrollRunId: run.id,
    payoutId: null,
    employeeId: null,
    employeeLabel: null,
  } as const;

  const events: PayrollEvent[] = [
    {
      ...base,
      id: `${run.id}:PAYROLL_RUN_CREATED`,
      kind: "PAYROLL_RUN_CREATED",
      amountStroops: run.totalStroops,
      txHash: null,
      message: null,
      occurredAt: run.createdAt,
    },
  ];

  if (run.status === "CHARGED") {
    events.push({
      ...base,
      id: `${run.id}:PAYROLL_RUN_CHARGED`,
      kind: "PAYROLL_RUN_CHARGED",
      amountStroops: run.totalStroops,
      txHash: run.txHash,
      message: null,
      occurredAt: run.chargedAt ?? run.updatedAt,
    });
  } else if (run.status === "FAILED") {
    events.push({
      ...base,
      id: `${run.id}:PAYROLL_RUN_FAILED`,
      kind: "PAYROLL_RUN_FAILED",
      amountStroops: run.totalStroops,
      txHash: run.txHash,
      message: run.lastError,
      occurredAt: run.updatedAt,
    });
  } else if (run.status === "CANCELLED") {
    events.push({
      ...base,
      id: `${run.id}:PAYROLL_RUN_CANCELLED`,
      kind: "PAYROLL_RUN_CANCELLED",
      amountStroops: run.totalStroops,
      txHash: null,
      message: null,
      occurredAt: run.updatedAt,
    });
  }

  return events;
}

/**
 * Events for a single payout.
 *
 * `PayrollPayout` has no status/timestamp of its own beyond `createdAt`, so the
 * lifecycle is derived: a charge tx means SENT; a pure-crypto payout (no
 * off-ramp job) is COMPLETED once charged; a payout whose parent run FAILED with
 * no charge tx is FAILED. Fiat completion/failure is surfaced by the off-ramp
 * events instead, to avoid duplicating a single logical outcome.
 */
function payoutEvents(
  payout: PayoutForEvents,
  run: RunForEvents,
  hasOffRamp: boolean,
): PayrollEvent[] {
  const base = {
    payrollRunId: run.id,
    payoutId: payout.id,
    employeeId: payout.employeeId,
    employeeLabel: employeeLabel(payout.employee),
    amountStroops: payout.amountStroops,
  } as const;

  const events: PayrollEvent[] = [
    {
      ...base,
      id: `${payout.id}:PAYOUT_CREATED`,
      kind: "PAYOUT_CREATED",
      txHash: null,
      message: null,
      occurredAt: payout.createdAt,
    },
  ];

  if (payout.txHash) {
    events.push({
      ...base,
      id: `${payout.id}:PAYOUT_SENT`,
      kind: "PAYOUT_SENT",
      txHash: payout.txHash,
      message: null,
      occurredAt: payout.createdAt,
    });
    if (!hasOffRamp) {
      events.push({
        ...base,
        id: `${payout.id}:PAYOUT_COMPLETED`,
        kind: "PAYOUT_COMPLETED",
        txHash: payout.txHash,
        message: null,
        occurredAt: payout.createdAt,
      });
    }
  } else if (run.status === "FAILED") {
    events.push({
      ...base,
      id: `${payout.id}:PAYOUT_FAILED`,
      kind: "PAYOUT_FAILED",
      txHash: null,
      message: run.lastError,
      occurredAt: run.updatedAt,
    });
  }

  return events;
}

const OFFRAMP_KIND: Partial<Record<OffRampPayoutJobStatus, EventKind>> = {
  QUOTED: "OFFRAMP_QUOTED",
  INITIATED: "OFFRAMP_INITIATED",
  COMPLETED: "OFFRAMP_COMPLETED",
  FAILED: "OFFRAMP_FAILED",
  CANCELLED: "OFFRAMP_CANCELLED",
};

/** Event for an off-ramp job's current status (PENDING/RUNNING emit nothing). */
function offRampEvents(job: OffRampJobForEvents): PayrollEvent[] {
  const kind = OFFRAMP_KIND[job.status];
  if (!kind) return [];

  const message =
    job.status === "FAILED" ? job.lastError : job.providerRef ? `ref ${job.providerRef}` : null;

  return [
    {
      id: `${job.id}:${kind}`,
      kind,
      payrollRunId: job.payrollRunId,
      payoutId: job.payrollPayoutId,
      employeeId: job.employeeId,
      employeeLabel: employeeLabel(job.employee),
      amountStroops: job.amountStroops,
      txHash: null,
      message,
      occurredAt: job.status === "COMPLETED" ? (job.completedAt ?? job.updatedAt) : job.updatedAt,
    },
  ];
}

/**
 * Synthesize the full, unpaginated event timeline for a set of runs and their
 * off-ramp jobs, sorted newest-first (`occurredAt DESC`, then `id DESC` as a
 * deterministic tie-break).
 */
export function synthesizeEvents(
  runs: RunForEvents[],
  jobs: OffRampJobForEvents[],
): PayrollEvent[] {
  const payoutsWithOffRamp = new Set(
    jobs.map((j) => j.payrollPayoutId).filter((id): id is string => id !== null),
  );

  const events: PayrollEvent[] = [];
  for (const run of runs) {
    events.push(...runEvents(run));
    for (const payout of run.payouts) {
      events.push(...payoutEvents(payout, run, payoutsWithOffRamp.has(payout.id)));
    }
  }
  for (const job of jobs) {
    events.push(...offRampEvents(job));
  }

  return sortEventsDesc(events);
}

/** Newest-first, with a stable id tie-break for events sharing a timestamp. */
export function sortEventsDesc(events: PayrollEvent[]): PayrollEvent[] {
  return [...events].sort((a, b) => {
    const t = b.occurredAt.getTime() - a.occurredAt.getTime();
    if (t !== 0) return t;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

/* -------------------------------------------------------------------------- */
/* Cursor pagination (in-memory, over the synthesized timeline)               */
/* -------------------------------------------------------------------------- */

/** Opaque cursor = base64url(`${occurredAtISO}|${id}`). */
export function encodeCursor(event: PayrollEvent): string {
  return Buffer.from(`${event.occurredAt.toISOString()}|${event.id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { time: number; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const sep = raw.lastIndexOf("|");
    if (sep < 0) return null;
    const time = new Date(raw.slice(0, sep)).getTime();
    const id = raw.slice(sep + 1);
    if (Number.isNaN(time) || !id) return null;
    return { time, id };
  } catch {
    return null;
  }
}

/**
 * Apply cursor + limit to a newest-first timeline. The cursor marks the last
 * event of the previous page; results are everything strictly older than it in
 * the (occurredAt DESC, id DESC) ordering.
 */
export function paginate(
  sorted: PayrollEvent[],
  cursor: string | undefined,
  limit: number,
): { data: PayrollEventOut[]; nextCursor: string | null } {
  let start = 0;
  if (cursor) {
    const c = decodeCursor(cursor);
    if (!c) throw new Error("INVALID_CURSOR");
    start = sorted.findIndex((e) => {
      const t = e.occurredAt.getTime();
      return t < c.time || (t === c.time && e.id < c.id);
    });
    if (start < 0) start = sorted.length;
  }

  const page = sorted.slice(start, start + limit);
  const hasMore = start + limit < sorted.length;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last) : null;

  return { data: page.map(serializeEvent), nextCursor };
}

export function serializeEvent(event: PayrollEvent): PayrollEventOut {
  return { ...event, occurredAt: event.occurredAt.toISOString() };
}
