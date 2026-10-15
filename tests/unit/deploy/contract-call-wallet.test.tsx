import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ContractCallButton from "@/components/deploy/contract-call-button";
import { contractCallPendingKey } from "@/lib/contract-call-pending";

const mocks = vi.hoisted(() => ({
  getWalletKit: vi.fn(),
  getAddress: vi.fn(),
  sign: vi.fn(),
  setWallet: vi.fn(),
  poll: vi.fn(),
  trackConnection: vi.fn(),
  toastError: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  verifySigned: vi.fn(),
  signedHash: vi.fn(),
}));
vi.mock("@/components/deploy/wallet-kit", () => ({ getWalletKit: mocks.getWalletKit }));
vi.mock("@/lib/hooks/use-poll-tx-status", () => ({ usePollTxStatus: () => mocks.poll }));
vi.mock("@/lib/wallet-tracking", () => ({ trackWalletConnection: mocks.trackConnection }));
vi.mock("@/lib/friendly-toast", () => ({ toastError: mocks.toastError }));
vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: mocks.success, warning: mocks.warning },
}));
// Cryptographic and installed-SWK behavior is exercised by the retained node
// selected-wallet-connection/wallet-signature suites. Here assert the component
// cannot bypass that validation on its way to submission.
vi.mock("@/lib/stellar/wallet-signature", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stellar/wallet-signature")>()),
  assertSignedWalletTransaction: mocks.verifySigned,
  signedWalletTransactionHash: mocks.signedHash,
}));

const ADDRESS = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const TESTNET = "Test SDF Network ; September 2015";
const HASH = "a".repeat(64);
const PENDING_KEY = contractCallPendingKey("deployment-one", "testnet");
type Props = ComponentProps<typeof ContractCallButton>;
type Choice = {
  onWalletSelected: (wallet: { id: string; name: string }) => void;
  onClosed: () => void;
};
let picker: Choice | undefined;
let props: Props;
const prepare = vi.fn();
const submit = vi.fn();
const onSuccess = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.stubGlobal("navigator", {
    locks: {
      request: async (_key: string, _options: unknown, callback: (lock: object) => Promise<void>) =>
        callback({}),
    },
  });
  picker = undefined;
  mocks.getAddress.mockResolvedValue({ address: ADDRESS });
  mocks.sign.mockResolvedValue({ signedTxXdr: "signed" });
  mocks.poll.mockResolvedValue({ status: "SUCCESS" });
  mocks.signedHash.mockReturnValue(HASH);
  prepare.mockResolvedValue({ xdr: "unsigned", networkPassphrase: TESTNET });
  submit.mockResolvedValue({ txHash: HASH });
  props = {
    deploymentId: "deployment-one",
    network: "testnet",
    actionKey: "subscription-charge",
    label: "CHARGE NOW",
    busyLabel: "CHARGING…",
    prepare,
    submit,
    onSuccess,
  };
  mocks.getWalletKit.mockResolvedValue({
    kit: {
      // Real SWK resolves openModal after rendering; choosing happens later.
      openModal: async (options: Choice) => {
        picker = options;
      },
      getAddress: mocks.getAddress,
      signTransaction: mocks.sign,
      setWallet: mocks.setWallet,
    },
    module: null,
    client: null,
  });
});
afterEach(() => vi.unstubAllGlobals());

async function open() {
  const view = render(<ContractCallButton {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /charge now/i }));
  await waitFor(() => expect(picker).toBeDefined());
  return view;
}
async function choose(id = "freighter") {
  await act(async () => {
    picker!.onWalletSelected({ id, name: id });
  });
}

describe("contract actions using the shared selected connection", () => {
  it("waits for selection and confirms through the supplied endpoints and server passphrase", async () => {
    await open();
    expect(prepare).not.toHaveBeenCalled();
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    await choose("selected-wallet");
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(mocks.setWallet).toHaveBeenCalledWith("selected-wallet");
    expect(prepare).toHaveBeenCalledWith(ADDRESS);
    expect(mocks.sign).toHaveBeenCalledWith("unsigned", {
      address: ADDRESS,
      networkPassphrase: TESTNET,
    });
    expect(submit).toHaveBeenCalledExactlyOnceWith("signed");
    expect(mocks.signedHash).toHaveBeenCalledWith(
      "testnet",
      "unsigned",
      "signed",
      ADDRESS,
      TESTNET,
    );
    expect(mocks.poll).toHaveBeenCalledWith("deployment-one", HASH);
    expect(mocks.trackConnection).toHaveBeenCalledWith({
      address: ADDRESS,
      network: "testnet",
      walletId: "selected-wallet",
      surface: "contract_call",
    });
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(mocks.success).toHaveBeenCalledWith("Transaction confirmed!");
    expect(
      (screen.getByRole("button", { name: /charge now/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("ignores duplicate clicks, repeated choices and the post-selection close event", async () => {
    const signed = deferred<{ signedTxXdr: string }>();
    mocks.sign.mockReturnValue(signed.promise);
    render(<ContractCallButton {...props} />);
    await act(async () => {
      const button = screen.getByRole("button");
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await waitFor(() => expect(picker).toBeDefined());
    expect(mocks.getWalletKit).toHaveBeenCalledOnce();
    await choose();
    await act(async () => {
      picker!.onWalletSelected({ id: "other-wallet", name: "other" });
      picker!.onClosed();
    });
    expect(prepare).toHaveBeenCalledOnce();
    expect(mocks.sign).toHaveBeenCalledOnce();
    expect(mocks.warning).not.toHaveBeenCalled();
    await act(async () => signed.resolve({ signedTxXdr: "signed" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledOnce();
  });

  it("picker dismissal permits a deliberate retry without preparing or signing", async () => {
    await open();
    await act(async () => picker!.onClosed());
    expect(prepare).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalledWith("Connection cancelled");
    fireEvent.click(screen.getByRole("button", { name: /charge now/i }));
    await waitFor(() => expect(mocks.getWalletKit).toHaveBeenCalledTimes(2));
    await choose();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledOnce();
  });

  it("signing rejection never submits and reports the existing transaction error", async () => {
    const rejection = new Error("User declined access");
    mocks.sign.mockRejectedValue(rejection);
    await open();
    await choose();
    expect(submit).not.toHaveBeenCalled();
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(rejection, "Transaction failed");
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not call success for failed finality", async () => {
    mocks.poll.mockResolvedValue({ status: "FAILED", errorMessage: "Contract refused" });
    await open();
    await choose();
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledOnce());
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Contract refused" }),
      "Transaction failed",
    );
  });
});

describe("contract action attempt ownership", () => {
  it.each(["deployment", "network", "arguments", "disabled", "unmount"])(
    "ignores stale picker callbacks after %s changes",
    async (change) => {
      const view = await open();
      const oldPicker = picker!;
      if (change === "unmount") view.unmount();
      else {
        const patch: Partial<Props> =
          change === "deployment"
            ? { deploymentId: "deployment-two" }
            : change === "network"
              ? { network: "mainnet" }
              : change === "arguments"
                ? { actionKey: "subscription-charge-new-arguments" }
                : { disabled: true };
        view.rerender(<ContractCallButton {...props} {...patch} />);
      }
      await act(async () => oldPicker.onWalletSelected({ id: "freighter", name: "Freighter" }));
      expect(prepare).not.toHaveBeenCalled();
      expect(mocks.sign).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
      expect(mocks.toastError).not.toHaveBeenCalled();
    },
  );

  it("cannot sign a prepared action whose arguments changed during preparation", async () => {
    const prepared = deferred<{ xdr: string; networkPassphrase: string }>();
    prepare.mockReturnValue(prepared.promise);
    const view = await open();
    await choose();
    view.rerender(<ContractCallButton {...props} actionKey="different-action-arguments" />);
    await act(async () => prepared.resolve({ xdr: "stale", networkPassphrase: TESTNET }));
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("cannot submit a signature returned after unmount", async () => {
    const signed = deferred<{ signedTxXdr: string }>();
    mocks.sign.mockReturnValue(signed.promise);
    const view = await open();
    await choose();
    view.unmount();
    await act(async () => signed.resolve({ signedTxXdr: "signed" }));
    expect(submit).not.toHaveBeenCalled();
    expect(mocks.poll).not.toHaveBeenCalled();
  });

  it("reconciles a dispatched hash after navigation without waiting for its HTTP response", async () => {
    const submitted = deferred<{ txHash: string }>();
    const finality = deferred<{ status: "SUCCESS" }>();
    submit.mockReturnValue(submitted.promise);
    mocks.poll.mockReturnValue(finality.promise);
    const view = await open();
    await choose();
    await waitFor(() => expect(mocks.poll).toHaveBeenCalledOnce());
    view.unmount();
    expect(JSON.parse(localStorage.getItem(PENDING_KEY)!)).toEqual({ txHash: HASH });
    await act(async () => finality.resolve({ status: "SUCCESS" }));
    await waitFor(() => expect(localStorage.getItem(PENDING_KEY)).toBeNull());
    await act(async () => submitted.resolve({ txHash: HASH }));
    expect(mocks.poll).toHaveBeenCalledWith("deployment-one", HASH);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("preserves status polling on unmount without showing stale success", async () => {
    const finality = deferred<{ status: "SUCCESS" }>();
    mocks.poll.mockReturnValue(finality.promise);
    const view = await open();
    await choose();
    await waitFor(() => expect(mocks.poll).toHaveBeenCalledOnce());
    view.unmount();
    expect(mocks.poll).toHaveBeenCalledExactlyOnceWith("deployment-one", HASH);
    await act(async () => finality.resolve({ status: "SUCCESS" }));
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("keeps the same logical attempt through unrelated parent callback rerenders", async () => {
    const view = await open();
    const nextPrepare = vi.fn();
    const nextSubmit = vi.fn();
    view.rerender(
      <ContractCallButton
        {...props}
        prepare={nextPrepare}
        submit={nextSubmit}
        onSuccess={vi.fn()}
      />,
    );
    await choose();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(prepare).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(nextPrepare).not.toHaveBeenCalled();
    expect(nextSubmit).not.toHaveBeenCalled();
  });

  it("an old signature cannot submit or clear a newer argument-specific attempt", async () => {
    const oldSignature = deferred<{ signedTxXdr: string }>();
    const newSignature = deferred<{ signedTxXdr: string }>();
    mocks.sign.mockReturnValueOnce(oldSignature.promise).mockReturnValueOnce(newSignature.promise);
    const view = await open();
    await choose();
    await act(async () => {
      view.rerender(<ContractCallButton {...props} actionKey="new-arguments" />);
    });
    fireEvent.click(screen.getByRole("button", { name: /charge now/i }));
    await waitFor(() => expect(mocks.getWalletKit).toHaveBeenCalledTimes(2));
    await choose();
    await act(async () => oldSignature.resolve({ signedTxXdr: "stale-signature" }));
    expect(submit).not.toHaveBeenCalled();
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => newSignature.resolve({ signedTxXdr: "current-signature" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledExactlyOnceWith("current-signature");
    expect(onSuccess).toHaveBeenCalledOnce();
  });
});

describe("contract action dispatch recovery", () => {
  it("saves only the computed hash before dispatch and never polls a substituted response hash", async () => {
    submit.mockImplementation(async () => {
      expect(JSON.parse(localStorage.getItem(PENDING_KEY)!)).toEqual({ txHash: HASH });
      return { txHash: "b".repeat(64) };
    });
    await open();
    await choose();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(mocks.poll).toHaveBeenCalledExactlyOnceWith("deployment-one", HASH);
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("blocks replacement after a post-dispatch argument change until authoritative finality", async () => {
    const response = deferred<{ txHash: string }>();
    const finality = deferred<{ status: "SUCCESS" }>();
    submit.mockReturnValue(response.promise);
    mocks.poll.mockReturnValue(finality.promise);
    const view = await open();
    await choose();
    await waitFor(() => expect(mocks.poll).toHaveBeenCalledOnce());
    view.rerender(<ContractCallButton {...props} actionKey="edited-allowance-amount" />);
    const action = screen.getByRole("button", { name: /charge now/i }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.click(action);
    expect(prepare).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem(PENDING_KEY)!)).toEqual({ txHash: HASH });
    await act(async () => finality.resolve({ status: "SUCCESS" }));
    await waitFor(() => expect(localStorage.getItem(PENDING_KEY)).toBeNull());
    expect(action.disabled).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
    await act(async () => response.resolve({ txHash: HASH }));
    expect(submit).toHaveBeenCalledOnce();
  });

  it("retains an unknown hash through unmount/remount and permits only read-only recovery", async () => {
    const response = deferred<{ txHash: string }>();
    const unknown = deferred<{ status: "PENDING" }>();
    submit.mockReturnValue(response.promise);
    mocks.poll.mockReturnValueOnce(unknown.promise).mockRejectedValue(new Error("RPC unavailable"));
    const view = await open();
    await choose();
    await waitFor(() => expect(mocks.poll).toHaveBeenCalledOnce());
    view.unmount();
    const recovered = render(
      <ContractCallButton {...props} actionKey="new-arguments-after-reload" />,
    );
    await waitFor(() => expect(screen.getByRole("status")).toBeDefined());
    expect(
      (screen.getByRole("button", { name: /charge now/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => unknown.resolve({ status: "PENDING" }));
    expect(JSON.parse(localStorage.getItem(PENDING_KEY)!)).toEqual({ txHash: HASH });
    fireEvent.click(screen.getByRole("button", { name: /check transaction status/i }));
    await waitFor(() => expect(mocks.poll).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("still unknown"));
    expect(prepare).toHaveBeenCalledOnce();
    expect(mocks.sign).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
    expect(localStorage.getItem(PENDING_KEY)).not.toBeNull();
    mocks.poll.mockResolvedValue({ status: "SUCCESS" });
    fireEvent.click(screen.getByRole("button", { name: /check transaction status/i }));
    await waitFor(() => expect(localStorage.getItem(PENDING_KEY)).toBeNull());
    expect(onSuccess).not.toHaveBeenCalled();
    recovered.unmount();
    await act(async () => response.resolve({ txHash: HASH }));
  });

  it("does not repeat a lost submission after polling fails; status retry clears only terminal FAILED", async () => {
    submit.mockRejectedValue(new Error("Connection lost after sending"));
    mocks.poll.mockRejectedValue(new Error("Timed out waiting for finality"));
    await open();
    await choose();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("still unknown"));
    expect(JSON.parse(localStorage.getItem(PENDING_KEY)!)).toEqual({ txHash: HASH });
    fireEvent.click(screen.getByRole("button", { name: /charge now/i }));
    expect(submit).toHaveBeenCalledOnce();
    mocks.poll.mockResolvedValue({ status: "FAILED", errorMessage: "Failed on-chain" });
    fireEvent.click(screen.getByRole("button", { name: /check transaction status/i }));
    await waitFor(() => expect(localStorage.getItem(PENDING_KEY)).toBeNull());
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mocks.sign).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
  });

  it("loads a persisted marker after reload without preparing, signing or submitting", async () => {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ txHash: HASH }));
    mocks.poll.mockRejectedValue(new Error("RPC temporarily missing the hash"));
    render(<ContractCallButton {...props} />);
    await waitFor(() => expect(mocks.poll).toHaveBeenCalledWith("deployment-one", HASH));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("still unknown"));
    expect(mocks.getWalletKit).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(localStorage.getItem(PENDING_KEY)).not.toBeNull();
  });

  it("refuses corrupt recovery storage without deleting it or opening a wallet", async () => {
    localStorage.setItem(PENDING_KEY, "corrupt-marker");
    render(<ContractCallButton {...props} />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("unavailable or invalid");
    expect(mocks.getWalletKit).not.toHaveBeenCalled();
    expect(localStorage.getItem(PENDING_KEY)).toBe("corrupt-marker");
  });

  it("never dispatches when its hash cannot be durably saved", async () => {
    const view = await open();
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage is unavailable");
    });
    await choose();
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledOnce());
    expect(submit).not.toHaveBeenCalled();
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("No transaction was submitted");
    view.unmount();
    storage.mockRestore();
  });

  it("rejects a desktop wallet's invalid envelope before saving or dispatching", async () => {
    mocks.signedHash.mockImplementation(() => {
      throw new Error("Wallet changed the prepared transaction.");
    });
    await open();
    await choose();
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledOnce());
    expect(submit).not.toHaveBeenCalled();
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("fails closed before wallet selection when Web Locks are unavailable", async () => {
    vi.stubGlobal("navigator", {});
    render(<ContractCallButton {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /charge now/i }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledOnce());
    expect(mocks.getWalletKit).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("WalletConnect contract actions", () => {
  async function walletConnect() {
    const shared = await mocks.getWalletKit();
    const session = (topic: string) => ({
      topic,
      expiry: Date.now() / 1000 + 600,
      namespaces: {
        stellar: { accounts: [`stellar:testnet:${ADDRESS}`], methods: ["stellar_signXDR"] },
      },
    });
    const client = {
      session: { values: [session("older-topic"), session("chosen-topic")] },
      request: vi.fn(async () => ({ signedXDR: "signed-wc" })),
    };
    mocks.getWalletKit.mockResolvedValue({
      ...shared,
      client,
      module: {
        connectWalletConnect: vi.fn(async () => ({
          id: "chosen-topic",
          accounts: [{ network: "testnet", publicKey: ADDRESS }],
        })),
      },
    });
    return client;
  }

  it("uses the selected topic despite an older same-account session and validates before submit", async () => {
    const client = await walletConnect();
    await open();
    await choose("wallet_connect");
    await waitFor(() => expect(submit).toHaveBeenCalledWith("signed-wc"));
    expect(client.request).toHaveBeenCalledExactlyOnceWith({
      topic: "chosen-topic",
      chainId: "stellar:testnet",
      request: { method: "stellar_signXDR", params: { xdr: "unsigned" } },
    });
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.verifySigned).toHaveBeenCalledWith("unsigned", "signed-wc", ADDRESS, TESTNET);
    expect(mocks.verifySigned.mock.invocationCallOrder[0]).toBeLessThan(
      submit.mock.invocationCallOrder[0]!,
    );
    expect(submit).toHaveBeenCalledWith("signed-wc");
  });

  it("does not submit a response rejected by signed-envelope validation", async () => {
    await walletConnect();
    mocks.verifySigned.mockImplementation(() => {
      throw new Error("Wallet changed the prepared transaction.");
    });
    await open();
    await choose("wallet_connect");
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledOnce());
    expect(submit).not.toHaveBeenCalled();
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Wallet changed the prepared transaction." }),
      "Transaction failed",
    );
  });

  it("rejects session removal while its signature response is pending", async () => {
    const client = await walletConnect();
    client.request.mockImplementation(async () => {
      client.session.values.splice(1, 1);
      return { signedXDR: "signed-wc" };
    });
    await open();
    await choose("wallet_connect");
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledOnce());
    expect(submit).not.toHaveBeenCalled();
    expect(mocks.verifySigned).not.toHaveBeenCalled();
  });
});

describe("allowance protocol cross-surface admission", () => {
  const key = "paiflow_allowance_pending:deployment-one:testnet";
  function saveApproval() {
    localStorage.setItem(key, JSON.stringify({ txHash: HASH, intent: "private-approval-intent" }));
  }
  it("blocks a generic action without copying, polling, or clearing the allowance intent", async () => {
    saveApproval();
    const original = localStorage.getItem(key);
    render(<ContractCallButton {...props} />);
    await waitFor(() =>
      expect(screen.getByText(/check its status on the allowance page/i)).toBeDefined(),
    );
    fireEvent.click(screen.getByRole("button", { name: /charge now/i }));
    expect(mocks.getWalletKit).not.toHaveBeenCalled();
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBe(original);
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });
  it("checks the allowance marker again inside the shared lock before wallet access", async () => {
    const locking = vi
      .spyOn(navigator.locks, "request")
      .mockImplementation(async (_key, _options, callback) => {
        saveApproval();
        return callback({} as Lock);
      });
    render(<ContractCallButton {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /charge now/i }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.getWalletKit).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    locking.mockRestore();
  });
  it("rejects an allowance marker that appears during wallet approval before generic admission", async () => {
    mocks.sign.mockImplementation(async () => {
      saveApproval();
      return { signedTxXdr: "signed" };
    });
    await open();
    await choose();
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(submit).not.toHaveBeenCalled();
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    expect(localStorage.getItem(key)).toContain("private-approval-intent");
  });
  it("fails closed on corrupt allowance state", async () => {
    localStorage.setItem(key, "{}");
    render(<ContractCallButton {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /charge now/i }));
    expect(mocks.getWalletKit).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBe("{}");
  });
  it("refreshes availability when allowance-specific reconciliation clears its marker", async () => {
    saveApproval();
    render(<ContractCallButton {...props} />);
    expect(
      (screen.getByRole("button", { name: /charge now/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => {
      localStorage.removeItem(key);
      window.dispatchEvent(new Event("paiflow-contract-call-pending"));
    });
    expect(
      (screen.getByRole("button", { name: /charge now/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
