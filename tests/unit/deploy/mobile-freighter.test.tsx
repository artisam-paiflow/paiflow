import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TriggerButton } from "@/components/deploy/trigger-button";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  setSession: vi.fn(),
  sign: vi.fn(),
  poll: vi.fn(),
}));

vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
vi.mock("@/lib/wallet-tracking", () => ({ trackWalletConnection: vi.fn() }));
vi.mock("@/lib/hooks/use-poll-tx-status", () => ({ usePollTxStatus: () => mocks.poll }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock("@walletconnect/modal", () => ({ WalletConnectModal: class {} }));
vi.mock("@walletconnect/sign-client", () => ({
  SignClient: { init: async () => ({ connect: mocks.connect, session: { values: [] } }) },
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
});
