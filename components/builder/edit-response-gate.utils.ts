/** One asynchronous draft edit at a time. Invalidating a generation/context
 * makes the original response inert; finishing it cannot unlock a newer edit. */
export function createBuilderEditGate() {
  let epoch = 0,
    serial = 0,
    active: number | null = null;
  return {
    get pending() {
      return active !== null;
    },
    invalidate() {
      epoch++;
    },
    begin() {
      if (active !== null) return null;
      const identity = ++serial,
        started = epoch;
      active = identity;
      return {
        isCurrent: () => active === identity && epoch === started,
        finish: () => {
          if (active === identity) active = null;
        },
      };
    },
  };
}
