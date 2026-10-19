import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { Account, Asset, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { track } from "@/lib/analytics/client";
import DeployReview from "@/components/deploy/deploy-review";
import { TriggerButton } from "@/components/deploy/trigger-button";

const ADDRESS = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const RECIPIENT = "GAUF2ILE2UGAAFJZBUSICBTRMOL5TDGBZRXHYO4O5P5RMAPJ24YCV2XQ";

const { signTransaction, pollTxStatus } = vi.hoisted(() => ({
  signTransaction: vi.fn(),
  pollTxStatus: vi.fn(),
}));

// jsdom and the SDK's Node Buffer have different Uint8Array realms. This UI
// cancellation suite mocks only the prepared hash; node signing-recovery and
// wallet-signature suites exercise real source/network/hash/signature binding.
vi.mock("@/lib/stellar/wallet-signature", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stellar/wallet-signature")>()),
  preparedWalletTransactionHash: () => "a".repeat(64),
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
    getAddress = async () => ({ address: ADDRESS });
    getNetwork = async () => ({ networkPassphrase: Networks.TESTNET });
    signTransaction = signTransaction;
    setWallet() {}
    async openModal(opts: {
      onWalletSelected: (wallet: { id: string; name: string }) => Promise<void>;
    }) {
      // Installed SWK resolves when the modal renders; selection arrives later.
      queueMicrotask(() => {
        void opts.onWalletSelected({ id: "freighter", name: "Freighter" });
      });
    }
  },
  FreighterModule: class {},
  WalletNetwork: {
    TESTNET: "Test SDF Network ; September 2015",
    PUBLIC: "Public Global Stellar Network ; September 2015",
  },
}));

describe("wallet signing cancellation analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", "");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    sessionStorage.clear();
    localStorage.clear();
    vi.stubGlobal("navigator", {
      locks: {
        request: async (
          _key: string,
          _options: unknown,
          callback: (lock: object) => Promise<void>,
        ) => callback({}),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(["deploy", "payment"] as const)(
    "classifies %s cancellation and never submits",
    async (surface) => {
      // FreighterApiDeclinedError from stellar/freighter shared extensionMessaging.ts;
      // installed FreighterModule -> parseError preserves its explicit -4 code.
      signTransaction.mockRejectedValue({
        code: -4,
        message: "The user rejected this request.",
        private: "wallet payload must not reach analytics",
      });
      const unsignedXdr = new TransactionBuilder(new Account(ADDRESS, "1"), {
        fee: "100",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.payment({ destination: RECIPIENT, amount: "1", asset: Asset.native() }),
        )
        .setTimeout(180)
        .build()
        .toXDR();
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            deploymentId: "22222222-2222-2222-2222-222222222222",
            xdr: unsignedXdr,
            networkPassphrase: Networks.TESTNET,
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

      await waitFor(() => expect(signTransaction).toHaveBeenCalledOnce());
      expect(signTransaction).toHaveBeenCalledWith(unsignedXdr, {
        address: ADDRESS,
        networkPassphrase: Networks.TESTNET,
      });
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Transaction cancelled in your wallet."),
      );
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
          deployment_id:
            surface === "deploy" ? "22222222-2222-2222-2222-222222222222" : "deployment-id",
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
