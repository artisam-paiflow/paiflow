import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDashboardBalanceAdmission } from "@/lib/stellar/dashboard-balance-admission";
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
it("bounds active/pending work and recovers after success, failure and overload", async () => {
  const admission = createDashboardBalanceAdmission({ activeLimit: 1, queueLimit: 1, waitMs: 100 });
  let finish!: () => void;
  const a = admission.run(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const b = admission.run(async () => "next");
  await expect(admission.run(async () => "excess")).rejects.toMatchObject({
    code: "RATE_LIMITED",
    retryAfterSeconds: 5,
  });
  expect(admission.stats()).toMatchObject({ active: 1, queued: 1 });
  finish();
  await a;
  expect(await b).toBe("next");
  await expect(
    admission.run(async () => {
      throw new Error("offline");
    }),
  ).rejects.toThrow("offline");
  expect(admission.stats()).toMatchObject({ active: 0, queued: 0, peakActive: 1, peakQueued: 1 });
});
it("expires or aborts queued reads without launching them or releasing live upstream work", async () => {
  const admission = createDashboardBalanceAdmission({ activeLimit: 1, waitMs: 100 });
  let finish!: () => void;
  const active = admission.run(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const work = vi.fn(async () => "never");
  const controller = new AbortController();
  const aborted = expect(admission.run(work, controller.signal)).rejects.toMatchObject({
    code: "RATE_LIMITED",
  });
  controller.abort();
  await aborted;
  const expired = expect(admission.run(work)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  await vi.advanceTimersByTimeAsync(100);
  await expired;
  expect(work).not.toHaveBeenCalled();
  expect(admission.stats()).toMatchObject({ active: 1, queued: 0 });
  finish();
  await active;
  expect(admission.stats().active).toBe(0);
});
