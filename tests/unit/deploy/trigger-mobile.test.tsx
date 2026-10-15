import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  connect: vi.fn(),
  request: vi.fn(),
  setSession: vi.fn(),
  getAddress: vi.fn(),
  sign: vi.fn(),
  poll: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
vi.mock("@/lib/wallet-tracking", () => ({ trackWalletConnection: vi.fn() }));
vi.mock("@/lib/hooks/use-poll-tx-status", () => ({ usePollTxStatus: () => mocks.poll }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock("@walletconnect/sign-client", () => ({ SignClient: { init: mocks.init } }));
vi.mock("@walletconnect/modal", () => ({ WalletConnectModal: class {} }));
vi.mock("@creit.tech/stellar-wallets-kit", () => ({
  StellarWalletsKit: class {
    getAddress = mocks.getAddress;
    signTransaction = mocks.sign;
    setWallet() {}
  },
  FreighterModule: class {},
  WalletNetwork: {
    TESTNET: "Test SDF Network ; September 2015",
    PUBLIC: "Public Global Stellar Network ; September 2015",
  },
}));
vi.mock("@creit.tech/stellar-wallets-kit/modules/walletconnect.module", () => ({
  WalletConnectModule: class {
    setSession = mocks.setSession;
  },
  WalletConnectAllowedMethods: { SIGN: "stellar_signXDR" },
}));
// Component tests focus on gesture/session routing. The node wallet-signature
// and wallet-connect-connection suites verify real envelopes cryptographically.
vi.mock("@/lib/stellar/wallet-signature", () => ({
  assertWalletNetwork: vi.fn(),
  assertSignedWalletTransaction: vi.fn(),
  signedWalletTransactionHash: () => "a".repeat(64),
}));
const address = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const hash = "a".repeat(64);
function session(topic = "approved-topic", pairingTopic = "approved-pairing") {
  return {
    topic,
    pairingTopic,
    expiry: Math.floor(Date.now() / 1000) + 3600,
    namespaces: {
      stellar: { accounts: [`stellar:testnet:${address}`], methods: ["stellar_signXDR"] },
    },
    peer: { metadata: { name: "Freighter" } },
  };
}
let sessions: ReturnType<typeof session>[];
let open: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  sessions = [];
  vi.stubEnv("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", "test-project");
  vi.stubGlobal("navigator", {
    locks: {
      request: async (_key: string, _options: unknown, callback: (lock: object) => Promise<void>) =>
        callback({}),
    },
  });
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("fetch", mocks.fetch);
  open = vi.spyOn(window, "open").mockImplementation(() => null);
  mocks.init.mockResolvedValue({
    session: { values: sessions },
    connect: mocks.connect,
    request: mocks.request,
  });
  mocks.connect.mockResolvedValue({
    uri: `wc:new-pairing@2?expiryTimestamp=${Math.floor(Date.now() / 1000) + 300}`,
    approval: () => new Promise(() => {}),
  });
  mocks.getAddress.mockResolvedValue({ address });
  mocks.sign.mockResolvedValue({ signedTxXdr: "signed" });
  mocks.request.mockResolvedValue({ signedXDR: "signed" });
  mocks.poll.mockResolvedValue({ status: "SUCCESS" });
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        xdr: "unsigned",
        networkPassphrase: "Test SDF Network ; September 2015",
        txHash: hash,
      },
    }),
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function mount(props: { amount?: string; disabled?: boolean } = {}) {
  const { TriggerButton } = await import("@/components/deploy/trigger-button");
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <TriggerButton deploymentId="deployment-id" network="testnet" amount="1000000" {...props} />,
    );
  });
  return view;
}
async function picker() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /connect wallet & trigger/i }));
  });
}
function remember() {
  localStorage.setItem(
    "paiflow_mobile_wallet:testnet",
    JSON.stringify({ topic: "approved-topic", walletId: "freighter", address }),
  );
}

describe("mobile trigger using the shared wallet kit", () => {
  it("pre-warms once and opens a fresh pairing synchronously in the wallet tap", async () => {
    await mount();
    await picker();
    expect(mocks.init).toHaveBeenCalledOnce();
    expect(mocks.connect).toHaveBeenCalledWith({
      requiredNamespaces: {
        stellar: {
          chains: ["stellar:testnet"],
          methods: ["stellar_signXDR"],
          events: [],
        },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Freighter" }));
    expect(open).toHaveBeenCalledOnce();
    expect(open.mock.calls[0]?.[0]).toContain(encodeURIComponent("wc:new-pairing@2?"));
    expect(JSON.parse(sessionStorage.getItem("paiflow_pending_wc")!)).toMatchObject({
      network: "testnet",
      walletId: "freighter",
      pairingTopic: "new-pairing",
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("hands a remembered connection back to its wallet before awaiting transaction preparation", async () => {
    sessions.push(session());
    remember();
    await mount();
    await picker();
    fireEvent.click(screen.getByRole("button", { name: /send with/i }));
    // These assertions run before any promise continuation: Android still has
    // the tap activation needed for its native app handoff.
    expect(open).toHaveBeenCalledWith("freighterwallet://wc-redirect", "_self");
    expect(mocks.fetch).not.toHaveBeenCalled();
    await act(async () => {});
    expect(mocks.request).toHaveBeenCalledWith({
      topic: "approved-topic",
      chainId: "stellar:testnet",
      request: { method: "stellar_signXDR", params: { xdr: "unsigned" } },
    });
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.poll).toHaveBeenCalledWith("deployment-id", hash);
    expect(mocks.init).toHaveBeenCalledOnce();
  });

  it("rechecks an expired remembered session before navigating or signing", async () => {
    sessions.push(session());
    remember();
    await mount();
    await picker();
    sessions[0]!.expiry = Math.floor(Date.now() / 1000) - 1;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send with/i }));
    });
    expect(open).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Freighter" })).toBeDefined();
  });

  it("resumes the exact pending pairing after a wallet return instead of an older stored session", async () => {
    sessions.push(session("older-topic", "older-pairing"), session());
    sessionStorage.setItem(
      "paiflow_pending_wc",
      JSON.stringify({
        boundAction: JSON.stringify([
          "deployment-id",
          "testnet",
          "1000000",
          "trigger",
          null,
          false,
        ]),
        network: "testnet",
        timestamp: Date.now(),
        walletId: "freighter",
        pairingTopic: "approved-pairing",
      }),
    );
    await mount();
    expect(mocks.init).toHaveBeenCalledOnce();
    expect(mocks.request).toHaveBeenCalledWith({
      topic: "approved-topic",
      chainId: "stellar:testnet",
      request: { method: "stellar_signXDR", params: { xdr: "unsigned" } },
    });
    expect(mocks.setSession).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.poll).toHaveBeenCalledWith("deployment-id", hash);
    expect(sessionStorage.getItem("paiflow_pending_wc")).toBeNull();
    expect(JSON.parse(localStorage.getItem("paiflow_mobile_wallet:testnet")!)).toMatchObject({
      topic: "approved-topic",
      address,
    });
  });

  it("closing the pre-warmed picker does not submit or discard its usable pairing", async () => {
    await mount();
    await picker();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    await picker();
    expect((screen.getByRole("button", { name: "Freighter" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(mocks.connect).toHaveBeenCalledOnce();
  });

  it("routes a fresh approval to its exact topic despite older same-account sessions", async () => {
    let approve!: (value: { topic: string }) => void;
    const approval = new Promise<{ topic: string }>((resolve) => {
      approve = resolve;
    });
    mocks.connect.mockResolvedValue({
      uri: `wc:new-pairing@2?expiryTimestamp=${Math.floor(Date.now() / 1000) + 300}`,
      approval: () => approval,
    });
    sessions.push(session("older-topic", "older-pairing"));
    await mount();
    await picker();
    await act(async () => {
      const freighter = screen.getByRole("button", { name: "Freighter" });
      fireEvent.click(freighter);
      fireEvent.click(freighter);
    });
    expect(open).toHaveBeenCalledOnce();
    expect(mocks.request).not.toHaveBeenCalled();
    await act(async () => {
      sessions.push(session("fresh-topic", "new-pairing"));
      approve({ topic: "fresh-topic" });
    });
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith({
      topic: "fresh-topic",
      chainId: "stellar:testnet",
      request: { method: "stellar_signXDR", params: { xdr: "unsigned" } },
    });
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.poll).toHaveBeenCalledWith("deployment-id", hash);
  });

  it("does not prepare or sign after a fresh approval returns to an unmounted action", async () => {
    let approve!: (value: { topic: string }) => void;
    const approval = new Promise<{ topic: string }>((resolve) => {
      approve = resolve;
    });
    mocks.connect.mockResolvedValue({
      uri: `wc:new-pairing@2?expiryTimestamp=${Math.floor(Date.now() / 1000) + 300}`,
      approval: () => approval,
    });
    const view = await mount();
    await picker();
    fireEvent.click(screen.getByRole("button", { name: "Freighter" }));
    await act(async () => {});
    view.unmount();
    await act(async () => {
      sessions.push(session("fresh-topic", "new-pairing"));
      approve({ topic: "fresh-topic" });
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(localStorage.getItem("paiflow_contract_call_pending:deployment-id:testnet")).toBeNull();
  });

  it.each(["legacy", "different-amount", "disabled"])(
    "never resumes a %s wallet-return marker into signing",
    async (kind) => {
      sessions.push(session());
      sessionStorage.setItem(
        "paiflow_pending_wc",
        JSON.stringify({
          ...(kind === "legacy"
            ? {}
            : {
                boundAction: JSON.stringify([
                  "deployment-id",
                  "testnet",
                  kind === "different-amount" ? "2" : "1000000",
                  "trigger",
                  null,
                  false,
                ]),
              }),
          network: "testnet",
          timestamp: Date.now(),
          walletId: "freighter",
          pairingTopic: "approved-pairing",
        }),
      );
      await mount({ disabled: kind === "disabled" });
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
      expect(mocks.sign).not.toHaveBeenCalled();
    },
  );

  it("does not resume an ambiguous pairing into any approved session", async () => {
    sessions.push(session(), session("second-topic", "approved-pairing"));
    sessionStorage.setItem(
      "paiflow_pending_wc",
      JSON.stringify({
        boundAction: JSON.stringify([
          "deployment-id",
          "testnet",
          "1000000",
          "trigger",
          null,
          false,
        ]),
        network: "testnet",
        timestamp: Date.now(),
        walletId: "freighter",
        pairingTopic: "approved-pairing",
      }),
    );
    await mount();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("paiflow_pending_wc")).toBeNull();
  });
});
