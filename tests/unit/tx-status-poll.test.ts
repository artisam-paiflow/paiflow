import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pollTxStatus } from "@/lib/tx-status-poll";

const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("@/lib/analytics/client", () => ({ track }));

const DEPLOYMENT_ID = "11111111-1111-4111-8111-111111111111";
const TX_HASH = "8a07ac5445f19a26388554c32b26d251e965890d33132fe6cb78b26edd968190";

function status(code: number): Response {
  return new Response(JSON.stringify({ error: { code: "X" } }), { status: code });
}

function ok(data: { status: string; errorMessage?: string }): Response {
  return new Response(JSON.stringify({ data }), { status: 200 });
}

const fetchMock = vi.fn<typeof fetch>();

/** Attach handlers before advancing timers, or a rejection is reported as unhandled. */
function settle(p: Promise<unknown>) {
  return p.then(
    (value) => ({ value, error: undefined as Error | undefined }),
    (error: Error) => ({ value: undefined, error }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  track.mockReset();
});

describe("pollTxStatus", () => {
  it("resolves SUCCESS and asks for the right transaction", async () => {
    fetchMock.mockResolvedValueOnce(ok({ status: "PENDING" }));
    fetchMock.mockResolvedValueOnce(ok({ status: "SUCCESS" }));

    const outcome = settle(pollTxStatus(DEPLOYMENT_ID, TX_HASH));
    await vi.advanceTimersByTimeAsync(4_000);

    expect((await outcome).value).toEqual({ status: "SUCCESS" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/deployments/${DEPLOYMENT_ID}/tx-status?txHash=${TX_HASH}`,
    );
    expect(track).not.toHaveBeenCalled();
  });

  it("keeps polling through a 429 and resolves SUCCESS (#434)", async () => {
    fetchMock.mockResolvedValueOnce(status(429));
    fetchMock.mockResolvedValueOnce(ok({ status: "SUCCESS" }));

    const outcome = settle(pollTxStatus(DEPLOYMENT_ID, TX_HASH));
    await vi.advanceTimersByTimeAsync(4_000);

    expect(await outcome).toEqual({ value: { status: "SUCCESS" }, error: undefined });
    expect(track).not.toHaveBeenCalled();
  });

  it("keeps polling through a 500 and resolves SUCCESS", async () => {
    fetchMock.mockResolvedValueOnce(status(500));
    fetchMock.mockResolvedValueOnce(ok({ status: "SUCCESS" }));

    const outcome = settle(pollTxStatus(DEPLOYMENT_ID, TX_HASH));
    await vi.advanceTimersByTimeAsync(4_000);

    expect((await outcome).value).toEqual({ status: "SUCCESS" });
    expect(track).not.toHaveBeenCalled();
  });

  it("backs off 2s, 4s, then 8s while the endpoint keeps refusing", async () => {
    const startedAt = Date.now();
    const calledAt: number[] = [];
    fetchMock.mockImplementation(async () => {
      calledAt.push(Date.now() - startedAt);
      return status(429);
    });

    const outcome = settle(pollTxStatus(DEPLOYMENT_ID, TX_HASH));
    await vi.advanceTimersByTimeAsync(61_000);
    await outcome;

    expect(calledAt.slice(0, 5)).toEqual([2_000, 4_000, 8_000, 16_000, 24_000]);
  });

  it("returns to the 2s interval once the endpoint answers again", async () => {
    const startedAt = Date.now();
    const calledAt: number[] = [];
    const replies = [
      status(429),
      status(429),
      ok({ status: "PENDING" }),
      ok({ status: "SUCCESS" }),
    ];
    fetchMock.mockImplementation(async () => {
      calledAt.push(Date.now() - startedAt);
      return replies.shift() ?? ok({ status: "SUCCESS" });
    });

    const outcome = settle(pollTxStatus(DEPLOYMENT_ID, TX_HASH));
    await vi.advanceTimersByTimeAsync(20_000);

    expect((await outcome).value).toEqual({ status: "SUCCESS" });
    expect(calledAt).toEqual([2_000, 4_000, 8_000, 10_000]);
  });

  it("reports a timeout, not an HTTP error, when every answer in the budget is a 429", async () => {
    fetchMock.mockImplementation(async () => status(429));

    const outcome = settle(pollTxStatus(DEPLOYMENT_ID, TX_HASH));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(track).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect((await outcome).error?.message).toBe("Timed out waiting for finality");
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("trigger_status_poll_failed", {
      deployment_id: DEPLOYMENT_ID,
      tx_hash: TX_HASH,
      reason: "timeout",
      http_status: 429,
    });
  });

  it("times out without an http_status when the transaction simply stays pending", async () => {
    fetchMock.mockImplementation(async () => ok({ status: "PENDING" }));

    const outcome = settle(pollTxStatus(DEPLOYMENT_ID, TX_HASH));
    await vi.advanceTimersByTimeAsync(60_000);

    expect((await outcome).error?.message).toBe("Timed out waiting for finality");
    expect(track).toHaveBeenCalledWith("trigger_status_poll_failed", {
      deployment_id: DEPLOYMENT_ID,
      tx_hash: TX_HASH,
      reason: "timeout",
    });
  });

  it("still rejects at once on a 4xx that will never succeed", async () => {
    fetchMock.mockResolvedValueOnce(status(404));

    const outcome = settle(pollTxStatus(DEPLOYMENT_ID, TX_HASH));
    await vi.advanceTimersByTimeAsync(2_000);

    expect((await outcome).error?.message).toBe("Failed to check transaction status");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("trigger_status_poll_failed", {
      deployment_id: DEPLOYMENT_ID,
      tx_hash: TX_HASH,
      reason: "http_error",
      http_status: 404,
    });
  });

  it("rejects on a network error and reports it with the tx hash", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const outcome = settle(pollTxStatus(DEPLOYMENT_ID, TX_HASH));
    await vi.advanceTimersByTimeAsync(2_000);

    expect((await outcome).error?.message).toBe("Network error while polling status");
    expect(track).toHaveBeenCalledWith("trigger_status_poll_failed", {
      deployment_id: DEPLOYMENT_ID,
      tx_hash: TX_HASH,
      reason: "network",
    });
  });

  it("resolves FAILED with the network's message", async () => {
    fetchMock.mockResolvedValueOnce(ok({ status: "FAILED", errorMessage: "tx_bad_seq" }));

    const outcome = settle(pollTxStatus(DEPLOYMENT_ID, TX_HASH));
    await vi.advanceTimersByTimeAsync(2_000);

    expect((await outcome).value).toEqual({ status: "FAILED", errorMessage: "tx_bad_seq" });
    expect(track).not.toHaveBeenCalled();
  });

  it("rejects promptly on an abort between checks, without an analytics event", async () => {
    fetchMock.mockImplementation(async () => ok({ status: "PENDING" }));
    const controller = new AbortController();

    const outcome = settle(pollTxStatus(DEPLOYMENT_ID, TX_HASH, controller.signal));
    await vi.advanceTimersByTimeAsync(2_500);
    controller.abort();
    // No timer advance: the rejection must not wait for the next 2s tick.
    await vi.advanceTimersByTimeAsync(0);

    expect((await outcome).error?.message).toBe("Polling aborted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
  });

  it("hands the signal to fetch, and an abort mid-flight is not reported as a network error", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );

    const outcome = settle(pollTxStatus(DEPLOYMENT_ID, TX_HASH, controller.signal));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    expect((await outcome).error?.message).toBe("Polling aborted");
    expect(track).not.toHaveBeenCalled();
  });

  it("rejects without fetching when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const outcome = await settle(pollTxStatus(DEPLOYMENT_ID, TX_HASH, controller.signal));

    expect(outcome.error?.message).toBe("Polling aborted");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });
});
