import { describe, it, expect } from "vitest";
import {
  synthesizeEvents,
  paginate,
  encodeCursor,
  sortEventsDesc,
  type OffRampJobForEvents,
  type PayrollEvent,
  type RunForEvents,
} from "@/lib/payroll/event-feed";

function run(overrides: Partial<RunForEvents> = {}): RunForEvents {
  return {
    id: "run-1",
    status: "CHARGED",
    totalStroops: "1000",
    txHash: "run-tx",
    chargedAt: new Date("2026-01-01T10:00:00Z"),
    createdAt: new Date("2026-01-01T09:00:00Z"),
    updatedAt: new Date("2026-01-01T10:00:00Z"),
    lastError: null,
    payouts: [],
    ...overrides,
  };
}

function payout(overrides: Partial<RunForEvents["payouts"][number]> = {}) {
  return {
    id: "payout-1",
    employeeId: "emp-1",
    amountStroops: "500",
    txHash: "payout-tx",
    createdAt: new Date("2026-01-01T09:30:00Z"),
    employee: { label: "Alice", address: "GABC" },
    ...overrides,
  };
}

function job(overrides: Partial<OffRampJobForEvents> = {}): OffRampJobForEvents {
  return {
    id: "job-1",
    status: "COMPLETED",
    amountStroops: "500",
    payrollRunId: "run-1",
    employeeId: "emp-1",
    payrollPayoutId: "payout-1",
    completedAt: new Date("2026-01-01T11:00:00Z"),
    updatedAt: new Date("2026-01-01T11:00:00Z"),
    lastError: null,
    providerRef: "PDAX-123",
    employee: { label: "Alice", address: "GABC" },
    ...overrides,
  };
}

function kinds(events: PayrollEvent[]): string[] {
  return events.map((e) => e.kind);
}

describe("synthesizeEvents", () => {
  it("emits created + charged for a charged run", () => {
    const events = synthesizeEvents([run({ payouts: [] })], []);
    expect(kinds(events).sort()).toEqual(["PAYROLL_RUN_CHARGED", "PAYROLL_RUN_CREATED"]);
    const charged = events.find((e) => e.kind === "PAYROLL_RUN_CHARGED")!;
    expect(charged.txHash).toBe("run-tx");
    expect(charged.occurredAt.toISOString()).toBe("2026-01-01T10:00:00.000Z");
  });

  it("emits failed with lastError message", () => {
    const events = synthesizeEvents(
      [run({ status: "FAILED", txHash: null, lastError: "boom" })],
      [],
    );
    const failed = events.find((e) => e.kind === "PAYROLL_RUN_FAILED")!;
    expect(failed.message).toBe("boom");
  });

  it("crypto payout (no off-ramp) is created, sent, and completed", () => {
    const events = synthesizeEvents([run({ payouts: [payout()] })], []);
    expect(kinds(events)).toContain("PAYOUT_CREATED");
    expect(kinds(events)).toContain("PAYOUT_SENT");
    expect(kinds(events)).toContain("PAYOUT_COMPLETED");
  });

  it("fiat payout completion is represented by the off-ramp job, not PAYOUT_COMPLETED", () => {
    const events = synthesizeEvents([run({ payouts: [payout()] })], [job()]);
    expect(kinds(events)).toContain("PAYOUT_SENT");
    expect(kinds(events)).not.toContain("PAYOUT_COMPLETED");
    expect(kinds(events)).toContain("OFFRAMP_COMPLETED");
    const offramp = events.find((e) => e.kind === "OFFRAMP_COMPLETED")!;
    expect(offramp.occurredAt.toISOString()).toBe("2026-01-01T11:00:00.000Z");
    expect(offramp.employeeLabel).toBe("Alice");
  });

  it("emits PAYOUT_FAILED when the run failed and the payout has no tx", () => {
    const events = synthesizeEvents(
      [
        run({
          status: "FAILED",
          txHash: null,
          lastError: "run failed",
          payouts: [payout({ txHash: null })],
        }),
      ],
      [],
    );
    const failed = events.find((e) => e.kind === "PAYOUT_FAILED")!;
    expect(failed.message).toBe("run failed");
    expect(failed.payoutId).toBe("payout-1");
  });

  it("PENDING/RUNNING off-ramp jobs emit no event", () => {
    const events = synthesizeEvents(
      [],
      [job({ status: "PENDING" }), job({ id: "j2", status: "RUNNING" })],
    );
    expect(events).toEqual([]);
  });

  it("falls back to employee address when label is null", () => {
    const events = synthesizeEvents(
      [run({ payouts: [payout({ employee: { label: null, address: "GXYZ" } })] })],
      [],
    );
    const created = events.find((e) => e.kind === "PAYOUT_CREATED")!;
    expect(created.employeeLabel).toBe("GXYZ");
  });

  it("stable event ids of the form rowId:kind", () => {
    const events = synthesizeEvents([run({ payouts: [payout()] })], [job()]);
    expect(events.map((e) => e.id)).toContain("run-1:PAYROLL_RUN_CREATED");
    expect(events.map((e) => e.id)).toContain("payout-1:PAYOUT_SENT");
    expect(events.map((e) => e.id)).toContain("job-1:OFFRAMP_COMPLETED");
  });

  it("sorts newest-first with deterministic id tie-break", () => {
    const same = new Date("2026-01-01T12:00:00Z");
    const events = sortEventsDesc([
      { id: "b", occurredAt: same } as PayrollEvent,
      { id: "a", occurredAt: same } as PayrollEvent,
      { id: "c", occurredAt: new Date("2026-01-01T13:00:00Z") } as PayrollEvent,
    ]);
    expect(events.map((e) => e.id)).toEqual(["c", "b", "a"]);
  });
});

describe("paginate", () => {
  const events: PayrollEvent[] = Array.from({ length: 5 }, (_, i) => ({
    id: `e${i}`,
    kind: "PAYOUT_CREATED",
    payrollRunId: null,
    payoutId: null,
    employeeId: null,
    employeeLabel: null,
    amountStroops: null,
    txHash: null,
    message: null,
    occurredAt: new Date(`2026-01-0${i + 1}T00:00:00Z`),
  }));
  const sorted = sortEventsDesc(events); // e4 (newest) .. e0 (oldest)

  it("returns the first page with a nextCursor when more remain", () => {
    const { data, nextCursor } = paginate(sorted, undefined, 2);
    expect(data.map((e) => e.id)).toEqual(["e4", "e3"]);
    expect(nextCursor).not.toBeNull();
  });

  it("walks pages via the cursor without overlap", () => {
    const p1 = paginate(sorted, undefined, 2);
    const p2 = paginate(sorted, p1.nextCursor!, 2);
    const p3 = paginate(sorted, p2.nextCursor!, 2);
    expect(p2.data.map((e) => e.id)).toEqual(["e2", "e1"]);
    expect(p3.data.map((e) => e.id)).toEqual(["e0"]);
    expect(p3.nextCursor).toBeNull();
  });

  it("serializes occurredAt to an ISO string", () => {
    const { data } = paginate(sorted, undefined, 1);
    expect(data[0]!.occurredAt).toBe("2026-01-05T00:00:00.000Z");
  });

  it("throws on a malformed cursor", () => {
    expect(() => paginate(sorted, "not-a-cursor", 2)).toThrow();
  });

  it("round-trips a cursor for a real event", () => {
    const c = encodeCursor(sorted[0]!);
    const { data } = paginate(sorted, c, 10);
    expect(data.map((e) => e.id)).toEqual(["e3", "e2", "e1", "e0"]);
  });
});
