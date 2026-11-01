import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ConfigurationPanel from "@/components/deploy/configuration-panel";
import {
  guestMutationState,
  mutationObservations,
  type GuestObservation,
} from "@/tests/fixtures/mutation-observations";
import {
  mutationPlatform,
  mutationReplacement,
  mutationScenarios,
} from "@/tests/fixtures/mutation-acceptance";

vi.hoisted(() =>
  Object.defineProperty(globalThis, "Uint8Array", {
    configurable: true,
    writable: true,
    value: Object.getPrototypeOf(Buffer.prototype).constructor,
  }),
);
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/prisma", () => ({ db: {} }));
vi.mock("@/components/deploy/wallet-kit", () => ({ getWalletKit: async () => ({}) }));
vi.mock("@/components/deploy/selected-wallet-connection", () => ({
  connectSelectedWallet: async () => {
    throw new Error("Read-only guest observation test must not access a wallet");
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const id = "11711171-1171-4171-8171-117111711171",
  ownerId = "77777777-7777-4777-8777-777777777777";
const fetcher = vi.fn();
let selected = mutationScenarios[0]!;
let observation: GuestObservation;
let ledger: number;
let failCurrent: boolean;
function state() {
  return guestMutationState(selected, observation, id, ledger);
}
beforeEach(() => {
  localStorage.clear();
  selected = mutationScenarios[0]!;
  observation = mutationObservations(selected).initial;
  ledger = 100;
  failCurrent = false;
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lock: object) => Promise<void>,
      ) => callback({}),
    },
  });
  fetcher.mockReset();
  fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if ((options?.method ?? "GET") !== "GET")
      throw new Error("Guest observation test must not prepare, sign or submit");
    const parsed = new URL(url, "https://mutation-acceptance.invalid");
    const prefix = `/api/deployments/${id}/configuration`;
    if (parsed.pathname !== prefix && parsed.pathname !== `${prefix}/history`)
      throw new Error("Unexpected editor request route");
    if (parsed.pathname === `${prefix}/history`) {
      const current = state();
      return Response.json({
        data: {
          deploymentId: id,
          network: "testnet",
          coverage: "observed-revisions-only",
          historyComplete: false,
          revisionCoverage: current.configurations.map((node) => ({
            nodeId: node.nodeId,
            highestObservedRevision: node.revision,
            observedRevisionCount: "1",
            missingRevisionCount: node.revision,
          })),
          items: current.configurations.map((configuration, index) => ({
            id: `${index + 1}1111111-1111-4111-8111-111111111111`,
            configuration,
            observedLedger: ledger,
            eventLedger: observation.events.length ? 101 : null,
            eventId: observation.events.length ? `actual-guest-config-${index}` : null,
            txHash: observation.events.length ? "f".repeat(64) : null,
          })),
          nextCursor: null,
        },
      });
    }
    if (failCurrent) throw new Error("Synthetic current-read outage");
    return Response.json({ data: state() });
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const show = () =>
  render(
    <ConfigurationPanel
      ownerId={ownerId}
      deploymentId={id}
      network="testnet"
      initialGraph={selected.graph}
    />,
  );
async function click(name: string) {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
}
describe("owner editor consumes actual compiled guest configuration evidence", () => {
  it("shows a direct external update/history while preserving the initial snapshot and hiding unverified current values", async () => {
    // Start after an externally signed update, with revision zero outside observation coverage.
    observation = mutationObservations(selected).changed;
    ledger = 101;
    show();
    const recipient = (await screen.findByRole("textbox", {
      name: "Recipient for fee",
    })) as HTMLInputElement;
    expect(recipient.value).toBe(mutationReplacement);
    expect(screen.getByTestId("network-chip").textContent).toBe("TESTNET");
    expect(screen.getByText(/Current configuration confirmed at ledger 101/)).toBeDefined();
    expect(screen.getByText(/Initial deployment snapshot/)).toBeDefined();
    expect(document.body.textContent).toContain(mutationPlatform);
    fireEvent.click(screen.getByText("Confirmed observed configuration history"));
    await screen.findByText(/fee: highest observed revision 1; retained 1; missing revisions 1/);
    expect(document.body.textContent).toContain("confirmed update event ledger 101");
    expect(document.body.textContent).toContain("not complete history");
    // Local read failure hides verified-current values, but never relabels the initial graph as current.
    failCurrent = true;
    await click("Check current configuration");
    await screen.findByText(/Current configuration could not be verified/);
    expect(screen.queryByRole("heading", { name: "Current confirmed values" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Recipient for fee" })).toBeNull();
    expect(selected.graph.nodes.find((node) => node.id === "fee")?.config).toMatchObject({
      recipient: mutationPlatform,
      amountStroops: "10",
    });
  });
  it("blocks editing/preparation from actual accounted-obligation bytes even when every guest raw balance is zero", async () => {
    selected = mutationScenarios[1]!;
    observation = mutationObservations(selected).blocked!;
    expect(observation.balances).toEqual(["0", "0", "0"]);
    show();
    await screen.findByText(/split: unsettled obligations 50 stroops/);
    expect(screen.getByText(/Updates are blocked by unsettled obligations/)).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Prepare update" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (
        screen
          .getByRole("textbox", { name: "Recipient for fee" })
          .closest("fieldset") as HTMLFieldSetElement
      ).disabled,
    ).toBe(true);
    expect(
      fetcher.mock.calls.every(([, options]) => !(options as RequestInit | undefined)?.method),
    ).toBe(true);
  });
});
