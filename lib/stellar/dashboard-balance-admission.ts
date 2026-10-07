import "server-only";
import { AppError } from "@/lib/errors";

/** Process-local dashboard batches only; active slots survive waiter timeouts. */
export function createDashboardBalanceAdmission({
  activeLimit = 2,
  queueLimit = 16,
  waitMs = 5_000,
} = {}) {
  let active = 0;
  let peakActive = 0;
  let peakQueued = 0;
  let rejected = 0;
  const queue: Array<() => void> = [];
  function overload() {
    rejected++;
    return new AppError(
      "RATE_LIMITED",
      "Dashboard balance refresh is busy; retry shortly",
      undefined,
      undefined,
      5,
    );
  }
  async function run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw overload();
    if (active >= activeLimit) {
      if (queue.length >= queueLimit) throw overload();
      await new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>;
        function cleanup() {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abandon);
          const index = queue.indexOf(start);
          if (index >= 0) queue.splice(index, 1);
        }
        function abandon() {
          cleanup();
          reject(overload());
        }
        function start() {
          cleanup();
          active++;
          resolve();
        }
        timer = setTimeout(abandon, waitMs);
        timer.unref?.();
        queue.push(start);
        peakQueued = Math.max(peakQueued, queue.length);
        signal?.addEventListener("abort", abandon, { once: true });
      });
    } else active++;
    peakActive = Math.max(peakActive, active);
    try {
      return await work();
    } finally {
      active--;
      queue[0]?.();
    }
  }
  return { run, stats: () => ({ active, queued: queue.length, peakActive, peakQueued, rejected }) };
}

export const dashboardBalanceAdmission = createDashboardBalanceAdmission();
