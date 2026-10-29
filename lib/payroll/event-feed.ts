import { z } from "zod";
import type { PayrollRunStatus } from "@prisma/client";
import {
  decodeCursor as decodeOpaqueCursor,
  encodeCursor as encodeOpaqueCursor,
} from "@/lib/api/v1/cursor";

/** Crypto payroll timelines synthesized from run/payout rows. Stable event IDs
 * and append-only transition timestamps preserve cursor pagination. */

export const EVENT_KINDS = [
  "PAYROLL_RUN_CREATED",
  "PAYROLL_RUN_CHARGED",
  "PAYROLL_RUN_FAILED",
  "PAYROLL_RUN_CANCELLED",
  "PAYOUT_CREATED",
  "PAYOUT_SENT",
  "PAYOUT_COMPLETED",
  "PAYOUT_FAILED",
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
  failedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastError: string | null;
  payouts: PayoutForEvents[];
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
      occurredAt: run.failedAt ?? run.updatedAt,
    });
  } else if (run.status === "CANCELLED") {
    events.push({
      ...base,
      id: `${run.id}:PAYROLL_RUN_CANCELLED`,
      kind: "PAYROLL_RUN_CANCELLED",
      amountStroops: run.totalStroops,
      txHash: null,
      message: null,
      occurredAt: run.cancelledAt ?? run.updatedAt,
    });
  }

  return events;
}

/** A recorded crypto charge emits SENT and COMPLETED; an uncharged failed run
 * emits FAILED without claiming a successful on-chain payment. */
function payoutEvents(payout: PayoutForEvents, run: RunForEvents): PayrollEvent[] {
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
    events.push({
      ...base,
      id: `${payout.id}:PAYOUT_COMPLETED`,
      kind: "PAYOUT_COMPLETED",
      txHash: payout.txHash,
      message: null,
      occurredAt: payout.createdAt,
    });
  } else if (run.status === "FAILED" || run.failedAt) {
    events.push({
      ...base,
      id: `${payout.id}:PAYOUT_FAILED`,
      kind: "PAYOUT_FAILED",
      txHash: null,
      message: run.lastError,
      occurredAt: run.failedAt ?? run.updatedAt,
    });
  }

  return events;
}

/** Synthesize the crypto payroll timeline with stable event IDs. */
export function synthesizeEvents(runs: RunForEvents[]): PayrollEvent[] {
  const events: PayrollEvent[] = [];
  for (const run of runs) {
    events.push(...runEvents(run));
    for (const payout of run.payouts) events.push(...payoutEvents(payout, run));
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
  return encodeOpaqueCursor(event.occurredAt.toISOString(), event.id);
}

export function decodeCursor(cursor: string): { time: number; id: string } | null {
  const parts = decodeOpaqueCursor(cursor);
  if (!parts) return null;
  const time = new Date(parts.head).getTime();
  if (Number.isNaN(time)) return null;
  return { time, id: parts.tail };
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
