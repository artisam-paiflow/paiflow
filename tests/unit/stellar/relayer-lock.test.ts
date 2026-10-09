import { afterEach, describe, expect, it, vi } from "vitest";
import { registerRelayerPendingBarrier, withRelayerLock } from "@/lib/stellar/client";

afterEach(() => registerRelayerPendingBarrier(async () => {}));

describe("source relayer pending barrier", () => {
  it("blocks every direct lock caller on reconciliation errors without poisoning the queue", async () => {
    const barrier = vi
      .fn()
      .mockRejectedValueOnce(new Error("unknown finality"))
      .mockResolvedValue(undefined);
    registerRelayerPendingBarrier(barrier);
    const submit = vi.fn().mockResolvedValue("submitted");
    await expect(withRelayerLock(submit)).rejects.toThrow("unknown finality");
    expect(submit).not.toHaveBeenCalled();
    await expect(withRelayerLock(submit)).resolves.toBe("submitted");
    expect(barrier).toHaveBeenCalledTimes(2);
  });

  it("keeps reconciliation and direct submission within the same source lock", async () => {
    const events: string[] = [];
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    registerRelayerPendingBarrier(async () => {
      events.push("reconcile");
      await pending;
    });
    const first = withRelayerLock(async () => {
      events.push("first");
    });
    const second = withRelayerLock(async () => {
      events.push("second");
    });
    await Promise.resolve();
    expect(events).toEqual(["reconcile"]);
    release?.();
    await Promise.all([first, second]);
    expect(events).toEqual(["reconcile", "first", "reconcile", "second"]);
  });
});
