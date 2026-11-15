import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { conditionalDeploymentFixture } from "@/tests/fixtures/conditional-deployment";
vi.hoisted(() =>
  Object.defineProperty(globalThis, "Uint8Array", {
    configurable: true,
    writable: true,
    value: Object.getPrototypeOf(Buffer.prototype).constructor,
  }),
);
const mocks = vi.hoisted(() => ({ balances: vi.fn(), events: vi.fn() }));
vi.mock("@/components/deploy/live-balances", () => ({
  default: (props: unknown) => {
    mocks.balances(props);
    return <div>Live balance evidence</div>;
  },
}));
vi.mock("@/components/deploy/live-events", () => ({
  LiveEvents: (props: unknown) => {
    mocks.events(props);
    return <div>Retained event evidence</div>;
  },
}));
import ConditionalOwnerView from "@/components/deploy/conditional-owner-view";
let sources: FakeSource[];
class FakeSource {
  onmessage: ((event: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(readonly url: string) {
    sources.push(this);
  }
}
const event = (eventId: string) => ({
  id: eventId,
  eventId,
  kind: "STATUS_CHANGE",
  ledger: 20,
  txHash: "aa".repeat(32),
  payload: { topics: ["route_v2", "condition"] },
  decodedData: { route: { selectedBranch: "false" } },
  occurredAt: new Date().toISOString(),
});
beforeEach(() => {
  vi.clearAllMocks();
  sources = [];
  vi.stubGlobal("EventSource", FakeSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ events: [event("polled")] })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("conditional owner initial evidence and activity", () => {
  it("retains immutable full owner/Return terms, addresses/artifact pins, status and common balance/event evidence", async () => {
    const f = conditionalDeploymentFixture();
    render(
      <ConditionalOwnerView
        deploymentId={f.deployment.id}
        original={f.paramsSnapshot}
        network="testnet"
        status="CONFIRMED"
        errorMessage={null}
        initialEvents={[event("initial")]}
      />,
    );
    expect(screen.getByText(/Immutable deployment owner:/).textContent).toContain(
      f.plan.definition.owner,
    );
    expect(screen.getByText(/Immutable owner recipient:/).textContent).toContain(
      f.plan.definition.owner,
    );
    expect(screen.getByText(/separate from current stored/)).toBeTruthy();
    expect(screen.getByText("Live balance evidence")).toBeTruthy();
    expect(screen.getByText("Retained event evidence")).toBeTruthy();
    await waitFor(() =>
      expect(
        mocks.events.mock.calls.at(-1)![0].events.map((item: { eventId: string }) => item.eventId),
      ).toEqual(["polled", "initial"]),
    );
    expect(document.body.textContent).not.toContain("private@example.invalid");
  });
  it("keeps distinct status events from the same transaction and ignores malformed messages", async () => {
    const f = conditionalDeploymentFixture();
    render(
      <ConditionalOwnerView
        deploymentId={f.deployment.id}
        original={f.paramsSnapshot}
        network="testnet"
        status="CONFIRMED"
        errorMessage={null}
        initialEvents={[]}
      />,
    );
    await waitFor(() => expect(mocks.events).toHaveBeenCalled());
    act(() => {
      sources[0]!.onmessage?.({ data: JSON.stringify(event("route")) });
      sources[0]!.onmessage?.({ data: JSON.stringify(event("configuration")) });
      sources[0]!.onmessage?.({ data: JSON.stringify({ id: "bad", kind: "PAYOUT", ledger: 50 }) });
    });
    await waitFor(() =>
      expect(
        mocks.events.mock.calls.at(-1)![0].events.map((item: { eventId: string }) => item.eventId),
      ).toEqual(expect.arrayContaining(["route", "configuration"])),
    );
    expect(
      mocks.events.mock.calls.at(-1)![0].events.some((item: { id: string }) => item.id === "bad"),
    ).toBe(false);
  });
  it("closes only its own activity connection on unmount", () => {
    const f = conditionalDeploymentFixture();
    const view = render(
      <ConditionalOwnerView
        deploymentId={f.deployment.id}
        original={f.paramsSnapshot}
        network="testnet"
        status="FAILED"
        errorMessage="not submitted"
        initialEvents={[]}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("FAILED · not submitted");
    view.unmount();
    expect(sources[0]!.close).toHaveBeenCalledOnce();
  });
});
