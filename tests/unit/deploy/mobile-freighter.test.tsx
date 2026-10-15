import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TriggerButton } from "@/components/deploy/trigger-button";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  setSession: vi.fn(),
  sign: vi.fn(),
  poll: vi.fn(),
  request: vi.fn(),
  sessions: [] as {
    topic: string;
    pairingTopic?: string;
    expiry: number;
    namespaces: { stellar: { accounts: string[]; methods: string[] } };
  }[],
}));

// Routing/approval tests use opaque envelope strings. Cryptographic transaction
// integrity remains covered by wallet-signature and wallet-connect-connection.
vi.mock("@/lib/stellar/wallet-signature", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stellar/wallet-signature")>()),
  assertSignedWalletTransaction: vi.fn(),
  signedWalletTransactionHash: () => "a".repeat(64),
}));
const ADDRESS = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const OTHER_ADDRESS = "GAUF2ILE2UGAAFJZBUSICBTRMOL5TDGBZRXHYO4O5P5RMAPJ24YCV2XQ";
const TESTNET = "Test SDF Network ; September 2015";
const PUBLIC = "Public Global Stellar Network ; September 2015";
vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
vi.mock("@/lib/wallet-tracking", () => ({ trackWalletConnection: vi.fn() }));
vi.mock("@/lib/hooks/use-poll-tx-status", () => ({ usePollTxStatus: () => mocks.poll }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock("@walletconnect/modal", () => ({ WalletConnectModal: class {} }));
vi.mock("@walletconnect/sign-client", () => ({
  SignClient: {
    init: async () => ({
      connect: mocks.connect,
      request: mocks.request,
      session: { values: mocks.sessions },
    }),
  },
}));
vi.mock("@creit.tech/stellar-wallets-kit/modules/walletconnect.module", () => ({
  WalletConnectModule: class {
    setSession = mocks.setSession;
  },
  WalletConnectAllowedMethods: { SIGN: "stellar_signXDR" },
}));
vi.mock("@creit.tech/stellar-wallets-kit", () => ({
  StellarWalletsKit: class {
    getAddress = async () => ({ address: ADDRESS });
    signTransaction = mocks.sign;
    setWallet() {}
  },
  FreighterModule: class {},
  WalletNetwork: {
    TESTNET: "Test SDF Network ; September 2015",
    PUBLIC: "Public Global Stellar Network ; September 2015",
  },
}));

describe("mobile Freighter deposit", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("navigator", {
      locks: {
        request: async (
          _key: string,
          _options: unknown,
          callback: (lock: object) => Promise<void>,
        ) => callback({}),
      },
    });
    mocks.connect.mockResolvedValue({
      uri: `wc:fresh-pairing@2?expiryTimestamp=${Math.floor(Date.now() / 1000) + 300}`,
      approval: () => new Promise(() => {}),
    });
    vi.stubEnv("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", "test-project");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    sessionStorage.clear();
    localStorage.clear();
    mocks.sessions.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(["approve", "reject"] as const)(
    "hands off a pairing, then %s signing before any deposit submission",
    async (decision) => {
      const uri = `wc:topic@2?relay-protocol=irn&symKey=test&expiryTimestamp=${Math.floor(Date.now() / 1000) + 300}`;
      let approveConnection!: (session: { topic: string }) => void;
      const approval = new Promise<{ topic: string }>((resolve) => {
        approveConnection = resolve;
      });
      mocks.connect.mockResolvedValue({ uri, approval: () => approval });
      let approveSignature!: (signed: { signedXDR: string }) => void;
      let rejectSignature!: (error: Error) => void;
      mocks.request.mockImplementation(
        () =>
          new Promise<{ signedXDR: string }>((resolve, reject) => {
            approveSignature = resolve;
            rejectSignature = reject;
          }),
      );
      mocks.poll.mockResolvedValue({ status: "SUCCESS" });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { xdr: "unsigned", networkPassphrase: TESTNET } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { txHash: "test-hash" } }),
        });
      vi.stubGlobal("fetch", fetchMock);
      const open = vi.spyOn(window, "open").mockReturnValue(null);

      await act(async () => {
        render(
          <TriggerButton deploymentId="deposit-id" network="testnet" amount="10000000" isDeposit />,
        );
      });
      fireEvent.click(screen.getByRole("button", { name: /connect wallet & deposit/i }));
      fireEvent.click(screen.getByRole("button", { name: "Freighter" }));
      expect(open).toHaveBeenCalledWith(
        `freighterwallet://wc-redirect/wc?uri=${encodeURIComponent(uri)}`,
        "_self",
        "noreferrer noopener",
      );
      expect(fetchMock).not.toHaveBeenCalled();

      await act(async () => {
        mocks.sessions.push({
          topic: "approved-topic",
          pairingTopic: "topic",
          expiry: Math.floor(Date.now() / 1000) + 3600,
          namespaces: {
            stellar: { accounts: [`stellar:testnet:${ADDRESS}`], methods: ["stellar_signXDR"] },
          },
        });
        approveConnection({ topic: "approved-topic" });
      });
      await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith({
          topic: "approved-topic",
          chainId: "stellar:testnet",
          request: { method: "stellar_signXDR", params: { xdr: "unsigned" } },
        }),
      );
      expect(mocks.setSession).not.toHaveBeenCalled();
      expect(mocks.sign).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole("button", { name: /open freighter to sign/i }));
      expect(open).toHaveBeenLastCalledWith("freighterwallet://wc-redirect", "_self");

      await act(async () => {
        if (decision === "approve") approveSignature({ signedXDR: "signed" });
        else rejectSignature(new Error("User rejected the request"));
      });
      await waitFor(() => expect(screen.queryByRole("button", { name: /processing/i })).toBeNull());
      if (decision === "approve") {
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenLastCalledWith(
          "/api/deployments/deposit-id/submit-trigger",
          expect.objectContaining({ body: JSON.stringify({ signedXdr: "signed" }) }),
        );
        expect(mocks.poll).toHaveBeenCalled();
      } else {
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(mocks.poll).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["approve", "reject", "network mismatch", "missing signature", "disconnect"] as const)(
    "reuses only the approved topic: %s",
    async (outcome) => {
      const address = ADDRESS;
      const session = { topic: "approved-topic", walletId: "freighter", address };
      localStorage.setItem("paiflow_mobile_wallet:testnet", JSON.stringify(session));
      // An older topic with the same account must never shadow the approved one.
      for (const topic of ["older-topic", session.topic])
        mocks.sessions.push({
          topic,
          expiry: Math.floor(Date.now() / 1000) + 3600,
          namespaces: {
            stellar: { accounts: [`stellar:testnet:${address}`], methods: ["stellar_signXDR"] },
          },
        });
      if (outcome === "reject")
        mocks.request.mockRejectedValue(new Error("User rejected the request"));
      else
        mocks.request.mockResolvedValue(
          outcome === "missing signature" ? {} : { signedXDR: "signed" },
        );
      mocks.poll.mockResolvedValue({ status: "SUCCESS" });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: {
              xdr: "unsigned",
              networkPassphrase: outcome === "network mismatch" ? PUBLIC : TESTNET,
            },
          }),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { txHash: "hash" } }) });
      vi.stubGlobal("fetch", fetchMock);
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      await act(async () => {
        render(
          <TriggerButton deploymentId="deposit-id" network="testnet" amount="10000000" isDeposit />,
        );
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /connect wallet & deposit/i }));
      });
      expect(screen.getByRole("button", { name: /send with/i }).title).toBe(address);
      expect(fetchMock).not.toHaveBeenCalled();
      if (outcome === "disconnect") mocks.sessions.splice(1, 1);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /send with/i }));
        // The native link must open before an async boundary loses Chrome's
        // user activation, without waiting for preparation or signing.
        expect(open).toHaveBeenCalledTimes(outcome === "disconnect" ? 0 : 1);
        expect(fetchMock).not.toHaveBeenCalled();
      });
      await waitFor(() => expect(screen.queryByRole("button", { name: /processing/i })).toBeNull());
      if (outcome === "disconnect") {
        expect(open).not.toHaveBeenCalled();
        expect(mocks.request).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "Freighter" })).toBeTruthy();
        return;
      }
      expect(open).toHaveBeenCalledOnce();
      expect(open).toHaveBeenCalledWith("freighterwallet://wc-redirect", "_self");
      expect(mocks.connect).not.toHaveBeenCalled();
      if (outcome === "network mismatch") {
        expect(mocks.request).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledOnce();
        return;
      }
      expect(mocks.request).toHaveBeenCalledWith({
        topic: session.topic,
        chainId: "stellar:testnet",
        request: { method: "stellar_signXDR", params: { xdr: "unsigned" } },
      });
      expect(fetchMock).toHaveBeenCalledTimes(outcome === "approve" ? 2 : 1);
    },
  );

  it("remembers the exact newly approved pairing after reload instead of the older saved wallet", async () => {
    const address = ADDRESS;
    const oldAddress = OTHER_ADDRESS;
    const old = { topic: "old-topic", walletId: "lobstr", address: oldAddress };
    localStorage.setItem("paiflow_mobile_wallet:testnet", JSON.stringify(old));
    for (const [topic, pairingTopic, account] of [
      [old.topic, "old-pairing", oldAddress],
      ["resumed-topic", "new-pairing", address],
    ])
      mocks.sessions.push({
        topic: topic!,
        pairingTopic,
        expiry: Math.floor(Date.now() / 1000) + 3600,
        namespaces: {
          stellar: { accounts: [`stellar:testnet:${account}`], methods: ["stellar_signXDR"] },
        },
      });
    sessionStorage.setItem(
      "paiflow_pending_wc",
      JSON.stringify({
        boundAction: JSON.stringify(["deposit-id", "testnet", "10000000", "trigger", null, true]),
        network: "testnet",
        timestamp: Date.now(),
        walletId: "freighter",
        pairingTopic: "new-pairing",
      }),
    );
    mocks.request.mockResolvedValue({ signedXDR: "signed" });
    mocks.poll.mockResolvedValue({ status: "SUCCESS" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { xdr: "unsigned", networkPassphrase: TESTNET } }),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { txHash: "hash" } }) }),
    );
    await act(async () => {
      render(
        <TriggerButton deploymentId="deposit-id" network="testnet" amount="10000000" isDeposit />,
      );
    });
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith({
        topic: "resumed-topic",
        chainId: "stellar:testnet",
        request: { method: "stellar_signXDR", params: { xdr: "unsigned" } },
      }),
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: /processing/i })).toBeNull());
    expect(mocks.setSession).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("paiflow_mobile_wallet:testnet")!)).toEqual({
      topic: "resumed-topic",
      walletId: "freighter",
      address,
    });
    expect(sessionStorage.getItem("paiflow_pending_wc")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /connect wallet & deposit/i }));
    });
    expect(screen.getByRole("button", { name: /send with/i })).toBeTruthy();
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
