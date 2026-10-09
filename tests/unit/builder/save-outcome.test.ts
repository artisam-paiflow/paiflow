import { describe, expect, it, vi } from "vitest";
import { sendWithRateLimitRetry } from "@/components/builder/autosave-retry.utils";
import { createSaveCoordinator, type SaveOutcome } from "@/components/builder/save-outcome.utils";

function deferred() {
  let resolve!: (outcome: SaveOutcome) => void;
  const promise = new Promise<SaveOutcome>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("save before deploy", () => {
  it.each([false, true])("navigates only when the save succeeds (ok=%s)", async (ok) => {
    const saves = createSaveCoordinator();
    const navigate = vi.fn();
    await saves.navigateAfterSave(
      saves.schedule(async () => ({ ok })),
      navigate,
    );
    expect(navigate).toHaveBeenCalledTimes(ok ? 1 : 0);
  });

  it("fails closed on a rejected save and allows a successful retry", async () => {
    const saves = createSaveCoordinator();
    const navigate = vi.fn();
    await saves.navigateAfterSave(
      saves.schedule(async () => {
        throw new Error("offline");
      }),
      navigate,
    );
    expect(navigate).not.toHaveBeenCalled();
    await saves.navigateAfterSave(
      saves.schedule(async () => ({ ok: true })),
      navigate,
    );
    expect(navigate).toHaveBeenCalledOnce();
  });

  it.each([false, true])("a superseding save decides (newer ok=%s)", async (ok) => {
    const saves = createSaveCoordinator();
    const first = deferred();
    const newer = deferred();
    const navigate = vi.fn();
    const initial = saves.schedule(() => first.promise);
    const deploying = saves.navigateAfterSave(initial, navigate);
    await Promise.resolve(); // Let the first request start.
    const sendNewer = vi.fn(() => newer.promise);
    saves.schedule(sendNewer);
    expect(sendNewer).not.toHaveBeenCalled(); // Older writes finish first.
    first.resolve({ ok: !ok });
    await initial;
    expect(navigate).not.toHaveBeenCalled();
    newer.resolve({ ok });
    await deploying;
    expect(sendNewer).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledTimes(ok ? 1 : 0);
  });

  it("follows superseding debounced saves, including one whose timer is cancelled", async () => {
    vi.useFakeTimers();
    try {
      const saves = createSaveCoordinator();
      const first = deferred();
      const navigate = vi.fn();
      const deploying = saves.navigateAfterSave(
        saves.schedule(() => first.promise),
        navigate,
      );
      await Promise.resolve();
      const skipped = vi.fn(async () => ({ ok: true }));
      const cancelled = saves.schedule(skipped, 800);
      saves.schedule(async () => ({ ok: false }), 800);
      expect(await cancelled).toEqual({ ok: false });
      first.resolve({ ok: true });
      await vi.advanceTimersByTimeAsync(800);
      await deploying;
      expect(skipped).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not navigate when a 429 retried once still fails", async () => {
    const saves = createSaveCoordinator();
    const navigate = vi.fn();
    const send = vi.fn(async () => new Response(null, { status: 429 }));
    const sleep = vi.fn(async () => {});
    await saves.navigateAfterSave(
      saves.schedule(async () => {
        const response = await sendWithRateLimitRetry(send, { maxRetries: 1, sleep });
        return { ok: response?.ok ?? false };
      }),
      navigate,
    );
    expect(send).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });
});
