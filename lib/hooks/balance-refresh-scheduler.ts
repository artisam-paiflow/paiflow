/** Completion-based browser scheduling, shared by visibility and event refreshes. */
export function createBalanceRefreshScheduler(
  load: (signal: AbortSignal) => Promise<{ retryMs?: number } | void>,
  random = Math.random,
) {
  let active = false;
  let pending = false;
  let visible = false;
  let stopped = false;
  let failures = 0;
  let notBefore = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  function clear() {
    clearTimeout(timer);
    timer = undefined;
  }
  function schedule(delay: number) {
    clear();
    if (visible && !stopped)
      timer = setTimeout(() => {
        timer = undefined;
        void start();
      }, delay);
  }
  async function start() {
    if (stopped || !visible) return;
    if (active) {
      pending = true;
      return;
    }
    if (Date.now() < notBefore) {
      schedule(notBefore - Date.now());
      return;
    }
    clear();
    active = true;
    pending = false;
    controller = new AbortController();
    let retryMs: number | undefined;
    try {
      retryMs = (await load(controller.signal))?.retryMs;
    } catch {
      retryMs = 0;
    } finally {
      active = false;
      if (stopped) return;
      if (retryMs !== undefined) {
        failures++;
        const backoff = Math.min(120_000, 5_000 * 2 ** Math.min(failures - 1, 5));
        notBefore = Date.now() + Math.max(retryMs, backoff) + random() * 1_000;
        schedule(notBefore - Date.now());
      } else {
        failures = 0;
        notBefore = 0;
        if (pending && visible) void start();
        else schedule(30_000 + random() * 3_000);
      }
    }
  }
  return {
    request() {
      pending = true;
      void start();
    },
    setVisible(value: boolean) {
      if (visible === value) return;
      visible = value;
      if (!value) clear();
      else {
        pending = true;
        void start();
      }
    },
    stop() {
      stopped = true;
      clear();
      controller?.abort();
    },
  };
}

export function balanceRetryAfter(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}
