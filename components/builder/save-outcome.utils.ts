export type SaveOutcome = { ok: boolean };

/** Debounce queued saves and serialize requests so an older write cannot land last. */
export function createSaveCoordinator() {
  let latest: Promise<SaveOutcome> | null = null;
  let tail: Promise<SaveOutcome> = Promise.resolve({ ok: true });
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelScheduled: (() => void) | null = null;

  function schedule(save: () => Promise<SaveOutcome>, delayMs = 0): Promise<SaveOutcome> {
    cancelScheduled?.();
    let resolve!: (outcome: SaveOutcome) => void;
    const pending = new Promise<SaveOutcome>((r) => {
      resolve = r;
    });
    latest = pending;
    const start = () => {
      timer = null;
      cancelScheduled = null;
      tail = tail.then(async () => {
        if (latest !== pending) return { ok: false };
        // Fail closed even if a caller unexpectedly rejects.
        return save().catch(() => ({ ok: false }));
      });
      void tail.then(resolve);
    };
    cancelScheduled = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      cancelScheduled = null;
      resolve({ ok: false });
    };
    if (delayMs === 0) start();
    else timer = setTimeout(start, delayMs);
    return pending;
  }

  /** Check and navigate in the same turn, after every superseding save has settled. */
  async function navigateAfterSave(save: Promise<SaveOutcome>, navigate: () => void) {
    let pending = save;
    for (;;) {
      const outcome = await pending;
      if (latest !== null && latest !== pending) {
        pending = latest;
        continue;
      }
      if (outcome.ok) navigate();
      return outcome;
    }
  }

  return { schedule, navigateAfterSave, cancel: () => cancelScheduled?.() };
}
