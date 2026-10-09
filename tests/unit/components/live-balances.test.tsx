import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LiveBalances from "@/components/deploy/live-balances";
import type { WorkflowBalances } from "@/lib/stellar/balances";
const asset = { kind: "native" } as const;
function data(amount = "10000000"): WorkflowBalances {
  return {
    totals: [{ asset, symbol: "XLM", balanceStroops: amount }],
    nodes: [],
    freshness: {
      status: "fresh",
      totalsComplete: true,
      attemptedAt: "2026-10-06T00:00:00Z",
      cached: true,
      targets: [
        {
          nodeId: "p",
          contractAddress: "contract",
          asset,
          symbol: "XLM",
          balanceStroops: amount,
          readAt: "2026-10-06T00:00:00Z",
          stale: false,
        },
      ],
    },
  };
}
function response(body: WorkflowBalances) {
  return { ok: true, json: async () => body } as Response;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.useRealTimers();
});
it("renders partial results and last-known failed targets without claiming a zero/complete balance", async () => {
  const partial = data();
  partial.totals = [];
  partial.freshness!.status = "partial";
  partial.freshness!.totalsComplete = false;
  partial.freshness!.targets[0]!.stale = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(partial)),
  );
  render(<LiveBalances deploymentId="d" network="testnet" />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByRole("status").textContent).toContain("Partial balances");
  expect(screen.getByText(/Last known.*stale/)).toBeTruthy();
  expect(screen.queryByText(/does not currently hold/)).toBeNull();
  expect(screen.getAllByText(/Oldest successful read/)).toHaveLength(1);
});
it("retains values visibly stale on failure and recovers", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(data()))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(response(data("20000000")));
  vi.stubGlobal("fetch", fetcher);
  render(<LiveBalances deploymentId="d" network="testnet" />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(screen.getByRole("status").textContent).toContain("stale");
  expect(screen.getByText("offline")).toBeTruthy();
  expect(screen.getByText("1")).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(screen.queryByText("offline")).toBeNull();
  expect(screen.getByText("2")).toBeTruthy();
});
it("aborts deployment changes/unmount and ignores obsolete responses even if transport ignores abort", async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(response(data("20000000")));
  vi.stubGlobal("fetch", fetcher);
  const view = render(<LiveBalances deploymentId="old" network="testnet" />);
  const signal = fetcher.mock.calls[0]![1].signal as AbortSignal;
  view.rerender(<LiveBalances deploymentId="new" network="testnet" />);
  expect(signal.aborted).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    finish(response(data()));
  });
  expect(screen.getByText("2")).toBeTruthy();
  expect(screen.queryByText("1")).toBeNull();
  view.unmount();
  expect((fetcher.mock.calls[1]![1].signal as AbortSignal).aborted).toBe(true);
});
it("refreshTick bursts join the active request rather than restarting the effect", async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(response(data()));
  vi.stubGlobal("fetch", fetcher);
  const view = render(<LiveBalances deploymentId="d" network="testnet" />);
  for (let tick = 1; tick < 10; tick++)
    view.rerender(<LiveBalances deploymentId="d" network="testnet" refreshTick={tick} />);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish(response(data()));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
