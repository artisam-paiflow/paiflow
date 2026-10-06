import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { track } from "@/lib/analytics/client";
import DeployReview from "@/components/deploy/deploy-review";
import { TriggerButton } from "@/components/deploy/trigger-button";

const { signTransaction, pollTxStatus } = vi.hoisted(() => ({
  signTransaction: vi.fn(),
  pollTxStatus: vi.fn(),
}));

vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
vi.mock("@/lib/wallet-tracking", () => ({ trackWalletConnection: vi.fn() }));
vi.mock("@/lib/hooks/use-poll-tx-status", () => ({ usePollTxStatus: () => pollTxStatus }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock("@walletconnect/modal", () => ({ WalletConnectModal: class {} }));
vi.mock("@walletconnect/sign-client", () => ({ SignClient: class {} }));
vi.mock("@creit.tech/stellar-wallets-kit/modules/walletconnect.module", () => ({
  WalletConnectModule: class {},
  WalletConnectAllowedMethods: { SIGN: "stellar_signXDR" },
}));
vi.mock("@creit.tech/stellar-wallets-kit", () => ({
  StellarWalletsKit: class {
    getAddress = async () => ({ address: `G${"A".repeat(55)}` });
    signTransaction = signTransaction;
    setWallet() {}
    async openModal(opts: {
      onWalletSelected: (wallet: { id: string; name: string }) => Promise<void>;
    }) {
      await opts.onWalletSelected({ id: "freighter", name: "Freighter" });
    }
  },
  FreighterModule: class {},
  WalletNetwork: { TESTNET: "testnet", PUBLIC: "mainnet" },
  FREIGHTER_ID: "freighter",
  allowAllModules: () => [],
}));

describe("wallet signing cancellation analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", "");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(["deploy", "payment"] as const)(
    "classifies %s cancellation and never submits",
    async (surface) => {
      // Shape emitted by the installed FreighterModule -> parseError adapter.
      signTransaction.mockRejectedValue({
        code: -1,
        message: "User declined access",
        ext: { private: "wallet payload must not reach analytics" },
      });
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            deploymentId: "deployment-id",
            xdr: "unsigned-test-transaction",
            networkPassphrase: "Test SDF Network ; September 2015",
          },
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      await act(async () => {
        render(
          surface === "deploy" ? (
            <DeployReview flowId="flow-id" network="testnet" />
          ) : (
            <TriggerButton deploymentId="deployment-id" network="testnet" amount="10000000" />
          ),
        );
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", {
            name: surface === "deploy" ? /deploy to testnet/i : /connect wallet & trigger/i,
          }),
        );
      });

      expect(signTransaction).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        surface === "deploy"
          ? "/api/deployments/prepare"
          : "/api/deployments/deployment-id/trigger",
      );
      expect(pollTxStatus).not.toHaveBeenCalled();
      expect(track).toHaveBeenCalledWith(
        surface === "deploy" ? "deploy_failed" : "trigger_failed",
        {
          ...(surface === "deploy" ? { flow_id: "flow-id" } : {}),
          deployment_id: "deployment-id",
          stage: "sign",
          error_class: "user_rejected",
          error_code: null,
        },
      );
      expect(track).toHaveBeenCalledWith("error_shown", {
        error_class: "user_rejected",
        error_code: null,
        message_key: "Transaction cancelled in your wallet.",
      });
      expect(toast.error).toHaveBeenCalledWith("Transaction cancelled in your wallet.");
      expect(JSON.stringify(vi.mocked(track).mock.calls)).not.toContain("wallet payload");
      expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
    },
  );
});
