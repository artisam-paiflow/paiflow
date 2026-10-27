import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TriggerButton } from "@/components/deploy/trigger-button";
const mocks = vi.hoisted(() => ({ sign: vi.fn(), poll: vi.fn(), fetch: vi.fn() }));
// Routing/reconciliation fixtures use opaque envelope strings. Real cryptographic
// envelope validation is covered by the node wallet-signature/connection suites.
vi.mock("@/lib/stellar/wallet-signature", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stellar/wallet-signature")>()),
  preparedWalletTransactionHash: () => "a".repeat(64),
  signedWalletTransactionHash: () => "a".repeat(64),
}));
vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
vi.mock("@/lib/wallet-tracking", () => ({ trackWalletConnection: vi.fn() }));
vi.mock("@/lib/hooks/use-poll-tx-status", () => ({ usePollTxStatus: () => mocks.poll }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/components/deploy/lantern-module", () => ({ LanternModule: class {} }));
vi.mock("@walletconnect/modal", () => ({ WalletConnectModal: class {} }));
vi.mock("@walletconnect/sign-client", () => ({ SignClient: class {} }));
vi.mock("@creit.tech/stellar-wallets-kit/modules/walletconnect.module", () => ({
  WalletConnectModule: class {},
  WalletConnectAllowedMethods: { SIGN: "stellar_signXDR" },
}));
vi.mock("@creit.tech/stellar-wallets-kit", () => ({
  StellarWalletsKit: class {
    getAddress = async () => ({
      address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    });
    getNetwork = async () => ({ networkPassphrase: "Test SDF Network ; September 2015" });
    signTransaction = mocks.sign;
    setWallet() {}
    async openModal(opts: {
      onWalletSelected: (wallet: { id: string; name: string }) => Promise<void>;
    }) {
      await opts.onWalletSelected({ id: "freighter", name: "Freighter" });
    }
  },
  FreighterModule: class {},
  WalletNetwork: {
    TESTNET: "Test SDF Network ; September 2015",
    PUBLIC: "Public Global Stellar Network ; September 2015",
  },
}));
const hash = "a".repeat(64);
const key = "paiflow_allowance_pending:deployment-id:testnet";
function mount(kind: "SUBSCRIPTION" | "PAYROLL" = "SUBSCRIPTION") {
  return render(
    <TriggerButton
      deploymentId="deployment-id"
      network="testnet"
      amount="200"
      mode="allowance"
      templateKind={kind}
    />,
  );
}
async function approve() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /connect wallet & approve/i }));
  });
  await waitFor(() => expect(screen.queryByRole("button", { name: /processing/i })).toBeNull());
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", "");
  vi.stubGlobal("navigator", {
    locks: {
      request: async (_key: string, _options: unknown, callback: (lock: object) => Promise<void>) =>
        callback({}),
    },
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.sign.mockResolvedValue({ signedTxXdr: "signed" });
  mocks.poll.mockResolvedValue({ status: "SUCCESS" });
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        xdr: "unsigned",
        intent: "server-intent",
        txHash: hash,
        networkPassphrase: "Test SDF Network ; September 2015",
      },
    }),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("wallet-only subscription browser flow", () => {
  it("still reconciles a saved approval when the subscriber becomes unconfigured or cancelled", async () => {
    localStorage.setItem(key, JSON.stringify({ txHash: hash, intent: "server-intent" }));
    await act(async () => {
      render(
        <TriggerButton
          deploymentId="deployment-id"
          network="testnet"
          amount="200"
          mode="allowance"
          templateKind="SUBSCRIPTION"
          disabled
        />,
      );
    });
    expect(mocks.poll).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("Allowance confirmed");
    expect(
      (screen.getByRole("button", { name: /connect wallet & approve/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("prepares and submits via the scoped public routes, including the server intent", async () => {
    mount();
    await approve();
    expect(mocks.fetch.mock.calls.map((call) => call[0])).toEqual([
      "/api/deployments/deployment-id/subscription-allowance",
      "/api/deployments/deployment-id/subscription-allowance/submit",
    ]);
    expect(JSON.parse(mocks.fetch.mock.calls[1]![1].body)).toEqual({
      signedXdr: "signed",
      intent: "server-intent",
    });
    expect(mocks.sign).toHaveBeenCalledWith(
      "unsigned",
      expect.objectContaining({ networkPassphrase: "Test SDF Network ; September 2015" }),
    );
    expect(screen.getByRole("status").textContent).toContain("Allowance confirmed");
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("polls the prepared hash after a lost submit response", async () => {
    mocks.fetch.mockReset();
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            xdr: "unsigned",
            intent: "server-intent",
            txHash: hash,
            networkPassphrase: "Test SDF Network ; September 2015",
          },
        }),
      })
      .mockRejectedValueOnce(new Error("Connection lost"));
    mount();
    await approve();
    expect(mocks.poll).toHaveBeenCalledWith(
      "deployment-id",
      hash,
      undefined,
      expect.stringContaining("subscription-allowance/status?intent="),
    );
    expect(screen.getByRole("status").textContent).toContain("Allowance confirmed");
  });
  it("blocks another approval on unknown finality and resumes the same hash after reload", async () => {
    mocks.poll.mockRejectedValue(new Error("Timeout"));
    const view = mount();
    await approve();
    expect(JSON.parse(localStorage.getItem(key)!).txHash).toBe(hash);
    expect(screen.getByRole("status").textContent).toContain("still unknown");
    expect(
      (screen.getByRole("button", { name: /connect wallet & approve/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    view.unmount();
    mocks.fetch.mockClear();
    mocks.sign.mockClear();
    mocks.poll.mockResolvedValue({ status: "SUCCESS" });
    await act(async () => {
      mount();
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("allows another attempt after confirmed failure", async () => {
    mocks.poll.mockResolvedValue({ status: "FAILED" });
    mount();
    await approve();
    expect(screen.getByRole("status").textContent).toContain("failed on the network");
    expect(localStorage.getItem(key)).toBeNull();
    expect(
      (screen.getByRole("button", { name: /connect wallet & approve/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
  it("does not submit or save a pending hash after rejected wallet signing", async () => {
    mocks.sign.mockRejectedValue({ code: -4, message: "The user rejected this request." });
    mount();
    await approve();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("shows a definite submit refusal without treating it as queued", async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            xdr: "unsigned",
            intent: "server-intent",
            txHash: hash,
            networkPassphrase: "Test SDF Network ; September 2015",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: { code: "FORBIDDEN", message: "Subscriber changed" } }),
      });
    mount();
    await approve();
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("retains payroll submission through its existing protected route", async () => {
    mount("PAYROLL");
    await approve();
    expect(mocks.fetch.mock.calls.map((call) => call[0])).toEqual([
      "/api/deployments/deployment-id/payroll-allowance",
      "/api/deployments/deployment-id/submit-invoke",
    ]);
  });
});
