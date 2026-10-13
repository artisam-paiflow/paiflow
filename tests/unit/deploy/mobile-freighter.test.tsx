import { act, fireEvent, render, screen } from "@testing-library/react";
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
    expiry: number;
    namespaces: { stellar: { accounts: string[]; methods: string[] } };
  }[],
}));

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
    getAddress = async () => ({ address: `G${"A".repeat(55)}` });
    signTransaction = mocks.sign;
    setWallet() {}
  },
  FreighterModule: class {},
  WalletNetwork: { TESTNET: "testnet", PUBLIC: "mainnet" },
}));

describe("mobile Freighter deposit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", "test-project");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    sessionStorage.clear();
    localStorage.clear();
    mocks.sessions.length = 0;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
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
      let approveSignature!: (signed: { signedTxXdr: string }) => void;
      let rejectSignature!: (error: Error) => void;
      mocks.sign.mockImplementation(
        () =>
          new Promise<{ signedTxXdr: string }>((resolve, reject) => {
            approveSignature = resolve;
            rejectSignature = reject;
          }),
      );
      mocks.poll.mockResolvedValue({ status: "SUCCESS" });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { xdr: "unsigned", networkPassphrase: "server-network" } }),
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
        approveConnection({ topic: "approved-topic" });
      });
      expect(mocks.setSession).toHaveBeenCalledWith("approved-topic");
      expect(mocks.sign).toHaveBeenCalledWith("unsigned", {
        address: `G${"A".repeat(55)}`,
        networkPassphrase: "server-network",
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole("button", { name: /open freighter to sign/i }));
      expect(open).toHaveBeenLastCalledWith("freighterwallet://wc-redirect", "_self");

      await act(async () => {
        if (decision === "approve") approveSignature({ signedTxXdr: "signed" });
        else rejectSignature(new Error("User rejected the request"));
      });
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
      const address = `G${"A".repeat(55)}`;
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
              networkPassphrase: outcome === "network mismatch" ? "mainnet" : "testnet",
            },
          }),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { txHash: "hash" } }) });
      vi.stubGlobal("fetch", fetchMock);
      await act(async () => {
        render(
          <TriggerButton deploymentId="deposit-id" network="testnet" amount="10000000" isDeposit />,
        );
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /connect wallet & deposit/i }));
      });
      expect(screen.getByRole("button", { name: /send with GAAAAA…AAAA/i }).title).toBe(address);
      expect(fetchMock).not.toHaveBeenCalled();
      if (outcome === "disconnect") mocks.sessions.splice(1, 1);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /send with GAAAAA…AAAA/i }));
      });
      if (outcome === "disconnect") {
        expect(mocks.request).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "Freighter" })).toBeTruthy();
        return;
      }
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
});
