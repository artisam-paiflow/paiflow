import { afterEach, expect, it, vi } from "vitest";
import { ttlDeadline } from "@/lib/stellar/ttl-deadline";

afterEach(() => vi.useRealTimers());

it("bounds a hung RPC and consumes one shared budget across calls", async () => {
  vi.useFakeTimers();
  const deadline = ttlDeadline(20_000);
  await vi.advanceTimersByTimeAsync(19_000);
  const call = deadline.run(() => new Promise<never>(() => {}));
  const rejected = expect(call).rejects.toThrow("time budget exhausted");
  await vi.advanceTimersByTimeAsync(1_000);
  await rejected;
  const work = vi.fn();
  await expect(deadline.run(work)).rejects.toThrow("time budget exhausted");
  expect(work).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("expires queued acquisition and rejects a late callback before it can sign", async () => {
  vi.useFakeTimers();
  const deadline = ttlDeadline(20_000);
  let enter: (() => void) | undefined;
  const sign = vi.fn();
  const call = deadline.acquire(
    (started) =>
      new Promise<void>((resolve, reject) => {
        enter = () => {
          try {
            started();
            sign();
            resolve();
          } catch (error) {
            reject(error);
          }
        };
      }),
  );
  const rejected = expect(call).rejects.toThrow("channel wait timed out");
  await vi.advanceTimersByTimeAsync(20_000);
  await rejected;
  enter!();
  await Promise.resolve();
  expect(sign).not.toHaveBeenCalled();
});

it("allows an acquired callback to finish recording known finality after the deadline", async () => {
  vi.useFakeTimers();
  const deadline = ttlDeadline(20_000);
  let finish: (() => void) | undefined;
  const call = deadline.acquire(async (started) => {
    started();
    return new Promise<string>((resolve) => {
      finish = () => resolve("recorded");
    });
  });
  await vi.advanceTimersByTimeAsync(25_000);
  finish!();
  await expect(call).resolves.toBe("recorded");
  expect(vi.getTimerCount()).toBe(0);
});
