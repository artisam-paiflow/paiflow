/**
 * The deployment page's live feed keeps three pieces of state — the event list,
 * the canvas pulse counter and the balance refresh counter — in one reducer, so
 * a dispatch React runs twice under Strict Mode cannot double-count either
 * counter. These cases pin that transition down.
 */
import { describe, expect, it } from "vitest";
import {
  eventsReducer,
  type EventsAction,
  type EventsState,
} from "@/components/deploy/deployment-events";
import type { Evt } from "@/components/deploy/live-events";

function evt(over: Partial<Evt> & Pick<Evt, "kind">): Evt {
  return {
    id: over.eventId ?? over.txHash ?? over.kind,
    ledger: 100,
    txHash: "tx-1",
    payload: null,
    decodedData: null,
    occurredAt: "2026-09-10T00:00:00.000Z",
    ...over,
  };
}

const empty: EventsState = { events: [], pulse: 0, balanceTick: 0 };

describe("eventsReducer", () => {
  it("merges new events, marks them new and advances both counters", () => {
    const next = eventsReducer(empty, {
      type: "merge",
      incoming: [evt({ kind: "RECEIVE", eventId: "e1" }), evt({ kind: "PAYOUT", eventId: "e2" })],
    });

    expect(next.events.map((e) => e.eventId)).toEqual(["e2", "e1"]);
    expect(next.events.every((e) => e._isNew)).toBe(true);
    expect(next.pulse).toBe(2);
    expect(next.balanceTick).toBe(2);
  });

  it("advances the balance counter without the pulse for non-value kinds", () => {
    const next = eventsReducer(empty, {
      type: "merge",
      incoming: [evt({ kind: "ALLOWANCE", eventId: "e1" })],
    });

    expect(next.pulse).toBe(0);
    expect(next.balanceTick).toBe(1);
  });

  it("leaves both counters alone for a kind that moves nothing", () => {
    const next = eventsReducer(empty, {
      type: "merge",
      incoming: [evt({ kind: "PAUSED", eventId: "e1" })],
    });

    expect(next.events).toHaveLength(1);
    expect(next.pulse).toBe(0);
    expect(next.balanceTick).toBe(0);
  });

  it("dedupes on eventId and on (txHash, kind)", () => {
    const seeded = eventsReducer(empty, {
      type: "merge",
      incoming: [evt({ kind: "RECEIVE", eventId: "e1", txHash: "tx-a" })],
    });

    const sameId = eventsReducer(seeded, {
      type: "merge",
      incoming: [evt({ kind: "PAYOUT", eventId: "e1", txHash: "tx-b" })],
    });
    expect(sameId.events).toHaveLength(1);
    expect(sameId.pulse).toBe(seeded.pulse);

    const sameTxAndKind = eventsReducer(seeded, {
      type: "merge",
      incoming: [evt({ kind: "RECEIVE", txHash: "tx-a" })],
    });
    expect(sameTxAndKind.events).toHaveLength(1);
    expect(sameTxAndKind.balanceTick).toBe(seeded.balanceTick);
  });

  it("sorts by ledger descending and keeps at most 100 events", () => {
    const next = eventsReducer(empty, {
      type: "merge",
      incoming: Array.from({ length: 120 }, (_, i) =>
        evt({ kind: "PAUSED", eventId: `e${i}`, txHash: `tx-${i}`, ledger: i }),
      ),
    });

    expect(next.events).toHaveLength(100);
    expect(next.events[0]?.ledger).toBe(119);
    expect(next.events[99]?.ledger).toBe(20);
  });

  it("refreshBalances bumps only the balance counter", () => {
    const next = eventsReducer(empty, { type: "refreshBalances" });

    expect(next.events).toEqual([]);
    expect(next.pulse).toBe(0);
    expect(next.balanceTick).toBe(1);
  });

  it("clearIsNew flips the flag without touching the counters", () => {
    const seeded = eventsReducer(empty, {
      type: "merge",
      incoming: [evt({ kind: "RECEIVE", eventId: "e1", txHash: "tx-a" })],
    });

    const cleared = eventsReducer(seeded, {
      type: "clearIsNew",
      eventId: "e1",
      txHash: "tx-a",
      kind: "RECEIVE",
    });

    expect(cleared.events[0]?._isNew).toBe(false);
    expect(cleared.pulse).toBe(seeded.pulse);
    expect(cleared.balanceTick).toBe(seeded.balanceTick);
  });

  it("is pure: the same dispatch applied twice to one state gives one result", () => {
    const action: EventsAction = {
      type: "merge",
      incoming: [evt({ kind: "RECEIVE", eventId: "e1" })],
    };

    const first = eventsReducer(empty, action);
    const second = eventsReducer(empty, action);

    expect(second).toEqual(first);
    expect(second.pulse).toBe(1);
    expect(second.balanceTick).toBe(1);
  });
});
