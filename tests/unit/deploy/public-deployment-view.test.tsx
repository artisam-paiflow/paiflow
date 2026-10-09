import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PublicView from "@/components/deploy/public-deployment-view";
import type { PublicEmbedData } from "@/lib/deployments/public-embed";
vi.mock("@/components/deploy/deployment-canvas", () => ({
  ReadOnlyDeploymentCanvas: () => <div>Canvas</div>,
}));

class Source {
  static instances: Source[] = [];
  listeners = new Map<string, (event: MessageEvent<string>) => void>();
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    Source.instances.push(this);
  }
  addEventListener(name: string, fn: (event: MessageEvent<string>) => void) {
    this.listeners.set(name, fn);
  }
  emit(name: string, value: unknown = {}) {
    this.listeners.get(name)?.(new MessageEvent(name, { data: JSON.stringify(value) }));
  }
}
const ID = "11111111-1111-4111-8111-111111111111";
const event = (eventId: string) => ({
  eventId,
  kind: "PAYOUT" as const,
  ledger: 10,
  txHash: "a".repeat(64),
  occurredAt: "2026-10-07T00:00:00Z",
});
const data: PublicEmbedData = {
  deploymentId: ID,
  network: "testnet",
  contractAddress: "C" + "A".repeat(55),
  graph: { nodes: [], edges: [] },
  initialEvents: [event("one")],
  payment: { path: `/trigger/${ID}`, mode: "pay" },
};
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  Source.instances = [];
  fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ data: { events: [event("one")] } }), { status: 200 }),
    );
  vi.stubGlobal("EventSource", Source);
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("public live view", () => {
  it("opens public reads only and renders a usable customer link/QR", async () => {
    await act(async () => {
      render(<PublicView data={data} />);
    });
    expect(Source.instances[0]?.url).toBe(`/api/deployments/${ID}/embed/events`);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/deployments/${ID}/embed/activity`);
    expect(screen.getByRole("link", { name: /Open payment page/ }).getAttribute("href")).toBe(
      `/trigger/${ID}`,
    );
    expect(screen.getByAltText("Payment page QR code").getAttribute("src")).toBe(
      `/api/deployments/${ID}/embed/qr`,
    );
    expect(screen.queryByText("Contract balance")).toBeNull();
  });
  it("shows live updates without reload and dedupes replay by event id", async () => {
    await act(async () => {
      render(<PublicView data={data} />);
    });
    act(() => {
      Source.instances[0]!.emit("connected");
      Source.instances[0]!.emit("snapshot", { events: [event("one"), event("two")] });
      Source.instances[0]!.emit("snapshot", { events: [event("one"), event("two")] });
    });
    expect(screen.getByRole("status").textContent).toBe("LIVE");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
  it("ignores malformed snapshots", async () => {
    await act(async () => {
      render(<PublicView data={data} />);
    });
    act(() => Source.instances[0]!.emit("snapshot", { events: [{ secret: "private" }] }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText("private")).toBeNull();
  });
  it("falls back to bounded reads and reconnects after a stream error", async () => {
    vi.useFakeTimers();
    await act(async () => {
      render(<PublicView data={data} />);
    });
    const source = Source.instances[0]!;
    act(() => {
      source.emit("connected");
      source.onerror!();
    });
    expect(source.close).toHaveBeenCalled();
    fetcher.mockImplementation(
      async () => new Response(JSON.stringify({ data: { events: [event("two")] } })),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(Source.instances).toHaveLength(2);
  });
  it("backs off public polling on 429", async () => {
    vi.useFakeTimers();
    fetcher.mockImplementation(
      async () => new Response(null, { status: 429, headers: { "Retry-After": "60" } }),
    );
    await act(async () => {
      render(<PublicView data={data} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    expect(fetcher).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("omits payment controls for unsupported deployments", async () => {
    await act(async () => {
      render(<PublicView data={{ ...data, payment: null }} />);
    });
    expect(screen.queryByAltText("Payment page QR code")).toBeNull();
    expect(screen.queryByRole("link", { name: /Open payment page/ })).toBeNull();
  });
  it("labels webhook/streamer deposits as funding", async () => {
    await act(async () => {
      render(<PublicView data={{ ...data, payment: { path: `/trigger/${ID}`, mode: "fund" } }} />);
    });
    expect(screen.getByText("Fund this flow")).toBeDefined();
    expect(screen.getByText(/It does not execute a webhook reward/)).toBeDefined();
  });
  it("closes connections and aborts pending reads on unmount", async () => {
    const view = await act(async () => render(<PublicView data={data} />));
    const signal = fetcher.mock.calls[0]?.[1].signal as AbortSignal;
    view.unmount();
    expect(Source.instances[0]!.close).toHaveBeenCalled();
    expect(signal.aborted).toBe(true);
  });
});
