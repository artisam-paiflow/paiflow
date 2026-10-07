import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  balanceRetryAfter,
  createBalanceRefreshScheduler,
} from "@/lib/hooks/balance-refresh-scheduler";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
it("coalesces slow reads and event bursts; periodic fallback waits for completion", async () => {
  let finish!: () => void;
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const scheduler = createBalanceRefreshScheduler(load, () => 0.5);
  scheduler.setVisible(true);
  for (let i = 0; i < 50; i++) scheduler.request();
  await vi.advanceTimersByTimeAsync(90_000);
  expect(load).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(31_499);
  expect(load).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(load).toHaveBeenCalledTimes(3);
  scheduler.stop();
});
it("visibility toggles do not overlap reads; hidden pages pause and teardown aborts", async () => {
  const load = vi.fn((_signal: AbortSignal) => new Promise<void>(() => {}));
  const scheduler = createBalanceRefreshScheduler(load);
  scheduler.setVisible(true);
  scheduler.setVisible(false);
  scheduler.setVisible(true);
  await vi.advanceTimersByTimeAsync(100_000);
  expect(load).toHaveBeenCalledTimes(1);
  const signal = load.mock.calls[0]?.[0];
  scheduler.stop();
  expect(signal?.aborted).toBe(true);
  scheduler.request();
  scheduler.setVisible(true);
  expect(load).toHaveBeenCalledTimes(1);
});
it("429 deadlines survive events and visibility; repeated outages back off and recovery resets", async () => {
  const load = vi
    .fn()
    .mockResolvedValueOnce({ retryMs: 60_000 })
    .mockResolvedValueOnce({ retryMs: 0 })
    .mockResolvedValue(undefined);
  const scheduler = createBalanceRefreshScheduler(load, () => 0);
  scheduler.setVisible(true);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(30_000);
  for (let i = 0; i < 50; i++) scheduler.request();
  scheduler.setVisible(false);
  scheduler.setVisible(true);
  await vi.advanceTimersByTimeAsync(29_999);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(load).toHaveBeenCalledTimes(2);
  scheduler.request();
  await vi.advanceTimersByTimeAsync(9_999);
  expect(load).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(load).toHaveBeenCalledTimes(3);
  scheduler.request();
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(4);
  scheduler.stop();
});
it("reads out-of-band changes on the periodic fallback and never schedules while hidden", async () => {
  let balance = "1";
  const reads: string[] = [];
  const scheduler = createBalanceRefreshScheduler(
    async () => {
      reads.push(balance);
    },
    () => 0,
  );
  scheduler.setVisible(true);
  await vi.advanceTimersByTimeAsync(0);
  balance = "2";
  await vi.advanceTimersByTimeAsync(30_000);
  expect(reads).toEqual(["1", "2"]);
  scheduler.setVisible(false);
  await vi.advanceTimersByTimeAsync(90_000);
  expect(reads).toHaveLength(2);
  scheduler.setVisible(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(reads).toHaveLength(3);
  scheduler.stop();
});
it("parses delta/date Retry-After and rejects malformed values", () => {
  expect(balanceRetryAfter("60")).toBe(60_000);
  expect(balanceRetryAfter("Thu, 01 Jan 1970 00:01:00 GMT", 0)).toBe(60_000);
  expect(balanceRetryAfter("invalid")).toBe(0);
  expect(balanceRetryAfter("-2")).toBe(0);
});
