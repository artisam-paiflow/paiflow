import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DeployReview from "@/components/deploy/deploy-review";
import EmployeeManager from "@/components/payroll/employee-manager";

const mocks = vi.hoisted(() => ({
  getWalletKit: vi.fn(),
  trackWalletConnection: vi.fn(),
  toastError: vi.fn(),
  warning: vi.fn(),
  signTransaction: vi.fn(),
  getAddress: vi.fn(),
  setWallet: vi.fn(),
}));
vi.mock("@/components/deploy/wallet-kit", () => ({ getWalletKit: mocks.getWalletKit }));
vi.mock("@/lib/wallet-tracking", () => ({ trackWalletConnection: mocks.trackWalletConnection }));
vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
vi.mock("@/lib/friendly-toast", () => ({ toastError: mocks.toastError }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: mocks.warning },
}));

const ADDRESS = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
let picker: {
  onWalletSelected: (wallet: { id: string; name: string }) => void;
  onClosed: () => void;
};
const response = (data: unknown, ok = true) => ({ ok, json: async () => ({ data }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAddress.mockResolvedValue({ address: ADDRESS });
  mocks.signTransaction.mockResolvedValue({ signedTxXdr: "signed" });
  mocks.getWalletKit.mockResolvedValue({
    kit: {
      openModal: vi.fn(async (options) => {
        picker = options;
      }),
      getAddress: mocks.getAddress,
      setWallet: mocks.setWallet,
      signTransaction: mocks.signTransaction,
    },
    module: null,
  });
});

async function choose(id = "freighter") {
  await act(async () => {
    picker.onWalletSelected({ id, name: id });
  });
}

describe("DeployReview shared picker", () => {
  it("waits for selection, tracks the picked wallet and signs with the server passphrase", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          deploymentId: "d",
          xdr: "unsigned",
          networkPassphrase: "server-pinned-passphrase",
        }),
      )
      // Refuse after the submit so jsdom doesn't attempt navigation.
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: "submission refused" } }),
      });
    vi.stubGlobal("fetch", fetcher);
    render(<DeployReview flowId="f" network="testnet" />);
    fireEvent.click(screen.getByRole("button", { name: /deploy to testnet/i }));
    await waitFor(() => expect(mocks.getWalletKit).toHaveBeenCalledWith("testnet"));
    await waitFor(() => expect(picker).toBeDefined());
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByRole("button").getAttribute("disabled")).not.toBeNull();
    await choose("lantern-test-double");
    expect(mocks.setWallet).toHaveBeenCalledWith("lantern-test-double");
    expect(mocks.trackWalletConnection).toHaveBeenCalledWith({
      address: ADDRESS,
      network: "testnet",
      walletId: "lantern-test-double",
      surface: "deploy_review",
    });
    expect(mocks.signTransaction).toHaveBeenCalledWith("unsigned", {
      address: ADDRESS,
      networkPassphrase: "server-pinned-passphrase",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({ signedXdr: "signed" });
  });

  it("pairs WalletConnect before resolving the address and preparing", async () => {
    const shared = await mocks.getWalletKit();
    const connectWalletConnect = vi.fn(async () => ({ id: "new-topic" }));
    const setSession = vi.fn();
    mocks.getWalletKit.mockResolvedValue({
      ...shared,
      module: { connectWalletConnect, setSession },
    });
    const fetcher = vi.fn().mockResolvedValue(response({}, false));
    vi.stubGlobal("fetch", fetcher);
    render(<DeployReview flowId="f" network="testnet" />);
    fireEvent.click(screen.getByRole("button", { name: /deploy to testnet/i }));
    await waitFor(() => expect(mocks.getWalletKit).toHaveBeenCalledWith("testnet"));
    await choose("wallet_connect");
    expect(connectWalletConnect).toHaveBeenCalledTimes(1);
    expect(setSession).toHaveBeenCalledWith("new-topic");
    expect(connectWalletConnect.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getAddress.mock.invocationCallOrder[0]!,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("wallet signing rejection never submits", async () => {
    mocks.signTransaction.mockRejectedValue(new Error("User rejected"));
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        response({ deploymentId: "d", xdr: "unsigned", networkPassphrase: "server-passphrase" }),
      );
    vi.stubGlobal("fetch", fetcher);
    render(<DeployReview flowId="f" network="testnet" />);
    fireEvent.click(screen.getByRole("button", { name: /deploy to testnet/i }));
    await waitFor(() => expect(mocks.getWalletKit).toHaveBeenCalled());
    await choose();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "User rejected" }),
      "Deploy failed",
    );
  });

  it("closing the picker before selection neither prepares nor signs", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<DeployReview flowId="f" network="mainnet" />);
    fireEvent.click(screen.getByRole("button", { name: /deploy to mainnet/i }));
    await waitFor(() => expect(mocks.getWalletKit).toHaveBeenCalledWith("mainnet"));
    await act(async () => {
      picker.onClosed();
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.signTransaction).not.toHaveBeenCalled();
    expect(screen.getByRole("button").getAttribute("disabled")).toBeNull();
  });

  it("refuses to sign when prepare omits the server network passphrase", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ deploymentId: "d", xdr: "unsigned" }));
    vi.stubGlobal("fetch", fetcher);
    render(<DeployReview flowId="f" network="testnet" />);
    fireEvent.click(screen.getByRole("button", { name: /deploy to testnet/i }));
    await waitFor(() => expect(mocks.getWalletKit).toHaveBeenCalled());
    await choose();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(mocks.signTransaction).not.toHaveBeenCalled();
  });

  it("ignores a close event after selection and repeated selection events", async () => {
    let complete!: (value: unknown) => void;
    const fetcher = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    render(<DeployReview flowId="f" network="testnet" />);
    fireEvent.click(screen.getByRole("button", { name: /deploy to testnet/i }));
    await waitFor(() => expect(mocks.getWalletKit).toHaveBeenCalled());
    await choose();
    await act(async () => {
      picker.onClosed();
      picker.onWalletSelected({ id: "other", name: "other" });
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button").getAttribute("disabled")).not.toBeNull();
    await act(async () => {
      complete(response({}, false));
    });
  });
});

describe("EmployeeManager shared picker", () => {
  it.each(["testnet", "mainnet"] as const)(
    "passes the deployment's %s network and records the selected wallet",
    async (network) => {
      const fetcher = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith("/payroll-recipients"))
          return response({ recipients: [{ address: ADDRESS, amount: "1000000" }] });
        if (url.endsWith("/employees/bank")) return response([]);
        if (url.endsWith("/payroll-update-recipients"))
          return response({
            unsignedXdr: "payroll-unsigned",
            networkPassphrase: "payroll-server-passphrase",
          });
        return response({});
      });
      vi.stubGlobal("fetch", fetcher);
      render(<EmployeeManager deploymentId="d" asset={{ kind: "native" }} network={network} />);
      fireEvent.click(await screen.findByRole("button", { name: "SAVE EMPLOYEES" }));
      await waitFor(() => expect(mocks.getWalletKit).toHaveBeenCalledWith(network));
      expect(
        screen.getByRole("button", { name: "SAVING…" }).getAttribute("disabled"),
      ).not.toBeNull();
      await choose("picked-wallet");
      expect(mocks.trackWalletConnection).toHaveBeenCalledWith({
        address: ADDRESS,
        network,
        walletId: "picked-wallet",
        surface: "payroll",
      });
      expect(mocks.signTransaction).toHaveBeenCalledWith("payroll-unsigned", {
        address: ADDRESS,
        networkPassphrase: "payroll-server-passphrase",
      });
      expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/submit-invoke"))).toHaveLength(1);
    },
  );
});
