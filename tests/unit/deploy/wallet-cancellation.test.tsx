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
    getAddress = async () => ({
      address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    });
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
  it.each(["http500", "lost-response"])(
    "recovers %s without another prepare or submit, including after reload",
    async (failure) => {
      signTransaction.mockResolvedValue({ signedTxXdr: "signed-envelope-private" });
      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        if (url === "/api/deployments/prepare")
          return {
            ok: true,
            json: async () => ({ data: { deploymentId: "deployment-id", xdr: "unsigned-xdr" } }),
          };
        if (url.endsWith("/status")) throw new Error("status read unavailable");
        expect(sessionStorage.getItem("paiflow-deploy-recovery:testnet:flow-id")).toBe(
          "deployment-id",
        );
        if (failure === "lost-response") throw new Error("Failed to fetch");
        return {
          ok: false,
          json: async () => ({ error: { code: "INTERNAL", message: "Internal server error" } }),
        };
      });
      vi.stubGlobal("fetch", fetchMock);
      const view = render(<DeployReview flowId="flow-id" network="testnet" />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /deploy to testnet/i }));
      });
      expect(screen.getByRole("link", { name: "View deployment" }).getAttribute("href")).toBe(
        "/deployments/deployment-id",
      );
      expect(
        (screen.getByRole("button", { name: /deploy to testnet/i }) as HTMLButtonElement).disabled,
      ).toBe(true);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /deploy to testnet/i }));
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      view.unmount();
      await act(async () => {
        render(<DeployReview flowId="flow-id" network="testnet" />);
      });
      expect(
        (screen.getByRole("button", { name: /deploy to testnet/i }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(
        fetchMock.mock.calls.filter(([url]) => url === "/api/deployments/prepare"),
      ).toHaveLength(1);
      expect(
        fetchMock.mock.calls.filter(([url]) => url === "/api/deployments/deployment-id/submit"),
      ).toHaveLength(1);
      expect(signTransaction).toHaveBeenCalledOnce();
      expect(sessionStorage.getItem("paiflow-deploy-recovery:testnet:flow-id")).toBe(
        "deployment-id",
      );
      expect(
        JSON.stringify([...Object.values(sessionStorage), vi.mocked(track).mock.calls]),
      ).not.toContain("signed-envelope-private");
      expect(vi.mocked(track).mock.calls.some(([event]) => event === "deploy_failed")).toBe(false);
    },
  );

  it("retries only the original envelope after an explicit network refusal", async () => {
    signTransaction.mockResolvedValue({ signedTxXdr: "signed-envelope-private" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { deploymentId: "deployment-id", xdr: "unsigned-xdr" } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: {
            code: "UPSTREAM_RPC",
            message: "The network is busy; submit the same envelope again",
            submissionStatus: "NOT_ACCEPTED",
          },
        }),
      })
      .mockRejectedValueOnce(new Error("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    render(<DeployReview flowId="flow-id" network="testnet" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /deploy to testnet/i }));
    });
    expect(screen.getByRole("alert").textContent).toContain("The network is busy");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /retry submission/i }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]).toEqual(fetchMock.mock.calls[2]);
    expect(signTransaction).toHaveBeenCalledOnce();
    expect(
      (screen.getByRole("button", { name: /deploy to testnet/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it.each(["CONFIRMED", "FAILED"])(
    "requires explicit consent to deploy another after %s",
    async (status) => {
      sessionStorage.setItem("paiflow-deploy-recovery:testnet:flow-id", "deployment-id");
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status }) });
      vi.stubGlobal("fetch", fetchMock);
      await act(async () => {
        render(<DeployReview flowId="flow-id" network="testnet" />);
      });
      expect(
        (screen.getByRole("button", { name: /deploy to testnet/i }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Deploy another" }));
      });
      expect(
        (screen.getByRole("button", { name: /deploy to testnet/i }) as HTMLButtonElement).disabled,
      ).toBe(false);
      expect(sessionStorage.getItem("paiflow-deploy-recovery:testnet:flow-id")).toBeNull();
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );
  it.each(["never-reached-server", "explicit-refusal"])(
    "resumes the original prepared identity after reload: %s",
    async () => {
      sessionStorage.setItem("paiflow-deploy-recovery:testnet:flow-id", "deployment-id");
      signTransaction.mockResolvedValue({ signedTxXdr: "signed-original" });
      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith("/status"))
          return { ok: true, json: async () => ({ status: "PENDING_SIGNATURE" }) };
        if (url === "/api/deployments/deployment-id")
          return {
            ok: true,
            json: async () => ({
              data: {
                id: "deployment-id",
                flowId: "flow-id",
                network: "testnet",
                sourceAccount: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
                serviceState: "ACTIVE",
                status: "PENDING_SIGNATURE",
                deployTxHash: null,
                preparedRecovery: {
                  status: "RESUMABLE",
                  network: "testnet",
                  sourceAccount: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
                  unsignedXdr: "original-unsigned-envelope",
                  txHash: "a".repeat(64),
                },
              },
            }),
          };
        throw new Error("Failed to fetch");
      });
      vi.stubGlobal("fetch", fetchMock);
      await act(async () => {
        render(<DeployReview flowId="flow-id" network="testnet" />);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "RESUME DEPLOYMENT" }));
      });
      expect(signTransaction).toHaveBeenCalledWith("original-unsigned-envelope", {
        address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        networkPassphrase: "Test SDF Network ; September 2015",
      });
      expect(
        fetchMock.mock.calls.filter(([url]) => url === "/api/deployments/prepare"),
      ).toHaveLength(0);
      expect(
        fetchMock.mock.calls.filter(([url]) => url === "/api/deployments/deployment-id/submit"),
      ).toHaveLength(1);
      expect(
        (screen.getByRole("button", { name: /deploy to testnet/i }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(JSON.stringify(Object.values(sessionStorage))).not.toContain(
        "original-unsigned-envelope",
      );
    },
  );

  it("offers explicit preparation after server-proven expiry without silently preparing", async () => {
    sessionStorage.setItem("paiflow-deploy-recovery:testnet:flow-id", "deployment-id");
    const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith("/status")
          ? { status: "PENDING_SIGNATURE" }
          : {
              data: {
                id: "deployment-id",
                flowId: "flow-id",
                network: "testnet",
                serviceState: "ACTIVE",
                status: "PENDING_SIGNATURE",
                deployTxHash: null,
                preparedRecovery: { status: "EXPIRED" },
              },
            },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      render(<DeployReview flowId="flow-id" network="testnet" />);
    });
    expect(
      (screen.getByRole("button", { name: /deploy to testnet/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(signTransaction).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Prepare another" }));
    });
    expect(
      (screen.getByRole("button", { name: /deploy to testnet/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["SUBMITTED", "blocked", "wrong-network", "wrong-flow", "wrong-wallet"])(
    "retains original identity for incompatible resume state %s",
    async (failure) => {
      sessionStorage.setItem("paiflow-deploy-recovery:testnet:flow-id", "deployment-id");
      const sourceAccount =
        failure === "wrong-wallet"
          ? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
          : "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
      const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
        ok: true,
        json: async () =>
          url.endsWith("/status")
            ? { status: failure === "SUBMITTED" ? "SUBMITTED" : "PENDING_SIGNATURE" }
            : {
                data: {
                  id: "deployment-id",
                  flowId: failure === "wrong-flow" ? "other-flow" : "flow-id",
                  network: failure === "wrong-network" ? "mainnet" : "testnet",
                  sourceAccount,
                  serviceState: "ACTIVE",
                  status: "PENDING_SIGNATURE",
                  deployTxHash: null,
                  preparedRecovery:
                    failure === "blocked"
                      ? { status: "BLOCKED" }
                      : {
                          status: "RESUMABLE",
                          network: "testnet",
                          sourceAccount,
                          unsignedXdr: "original-unsigned-envelope",
                          txHash: "a".repeat(64),
                        },
                },
              },
      }));
      vi.stubGlobal("fetch", fetchMock);
      await act(async () => {
        render(<DeployReview flowId="flow-id" network="testnet" />);
      });
      if (failure === "wrong-wallet")
        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: "RESUME DEPLOYMENT" }));
        });
      else
        expect(
          (screen.getByRole("button", { name: /deploy to testnet/i }) as HTMLButtonElement)
            .disabled,
        ).toBe(true);
      expect(signTransaction).not.toHaveBeenCalled();
      expect(
        fetchMock.mock.calls.some(
          ([url]) => url.endsWith("/submit") || url === "/api/deployments/prepare",
        ),
      ).toBe(false);
      expect(sessionStorage.getItem("paiflow-deploy-recovery:testnet:flow-id")).toBe(
        "deployment-id",
      );
    },
  );
});
