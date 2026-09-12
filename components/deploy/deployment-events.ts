import type { Evt } from "./live-events";

export type EventsState = {
  events: Evt[];
  /** Bumped once per new event that moves value; drives the canvas edge pulse. */
  pulse: number;
  /** Bumped once per new event that changes a balance; drives the balance refetch. */
  balanceTick: number;
};

export type EventsAction =
  | { type: "merge"; incoming: Evt[] }
  | { type: "clearIsNew"; eventId: string | undefined; txHash: string; kind: string }
  /** A contract call this page made itself; no event has landed yet. */
  | { type: "refreshBalances" };

const PULSE_KINDS = new Set(["RECEIVE", "PAYOUT"]);

const BALANCE_KINDS = new Set([
  "RECEIVE",
  "PAYOUT",
  "CLAIM",
  "CANCEL",
  "SHORTFALL",
  "FORWARD",
  "ALLOWANCE",
]);

const MAX_EVENTS = 100;

/**
 * The pulse and balance counters advance in the same transition as the merge
 * that produced them. React may run a reducer more than once for one dispatch,
 * so bumping them with `setState` from inside the events updater double-counted
 * under Strict Mode.
 */
export function eventsReducer(state: EventsState, action: EventsAction): EventsState {
  switch (action.type) {
    case "merge": {
      const merged = [...state.events];
      let addedPulses = 0;
      let balanceChanges = 0;

      for (const data of action.incoming) {
        const isDuplicate = merged.some(
          (p) =>
            (p.eventId && data.eventId && p.eventId === data.eventId) ||
            (p.txHash === data.txHash && p.kind === data.kind),
        );
        if (isDuplicate) continue;

        merged.push({ ...data, _isNew: true });
        if (PULSE_KINDS.has(data.kind)) addedPulses += 1;
        if (BALANCE_KINDS.has(data.kind)) balanceChanges += 1;
      }

      merged.sort((a, b) => {
        if (a.ledger !== b.ledger) return b.ledger - a.ledger;
        return (b.eventId ?? "").localeCompare(a.eventId ?? "");
      });

      return {
        events: merged.slice(0, MAX_EVENTS),
        pulse: state.pulse + addedPulses,
        balanceTick: state.balanceTick + balanceChanges,
      };
    }

    case "refreshBalances":
      return { ...state, balanceTick: state.balanceTick + 1 };

    case "clearIsNew": {
      const { eventId, txHash, kind } = action;
      return {
        ...state,
        events: state.events.map((e) =>
          (e.eventId && eventId && e.eventId === eventId) ||
          (e.txHash === txHash && e.kind === kind)
            ? { ...e, _isNew: false }
            : e,
        ),
      };
    }
  }
}
