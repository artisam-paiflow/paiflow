import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ContractCallButton from "@/components/deploy/contract-call-button";

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
}));

const ADDRESS = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const TESTNET = "Test SDF Network ; September 2015";
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
  picker = undefined;
  mocks.getAddress.mockResolvedValue({ address: ADDRESS });
  mocks.sign.mockResolvedValue({ signedTxXdr: "signed" });
  mocks.poll.mockResolvedValue({ status: "SUCCESS" });
  prepare.mockResolvedValue({ xdr: "unsigned", networkPassphrase: TESTNET });
  submit.mockResolvedValue({ txHash: "confirmed-hash" });
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
    expect(mocks.setWallet).toHaveBeenCalledWith("selected-wallet");
    expect(prepare).toHaveBeenCalledWith(ADDRESS);
    expect(mocks.sign).toHaveBeenCalledWith("unsigned", {
      address: ADDRESS,
      networkPassphrase: TESTNET,
    });
    expect(submit).toHaveBeenCalledExactlyOnceWith("signed");
    expect(mocks.poll).toHaveBeenCalledWith(
      "deployment-one",
      "confirmed-hash",
      expect.any(AbortSignal),
    );
    expect(mocks.trackConnection).toHaveBeenCalledWith({
      address: ADDRESS,
      network: "testnet",
      walletId: "selected-wallet",
      surface: "contract_call",
    });
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(mocks.success).toHaveBeenCalledWith("Transaction confirmed!");
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
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

  it("does not poll or show stale success when submission finishes after navigation", async () => {
    const submitted = deferred<{ txHash: string }>();
    submit.mockReturnValue(submitted.promise);
    const view = await open();
    await choose();
    view.unmount();
    await act(async () => submitted.resolve({ txHash: "already-submitted" }));
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("aborts status polling on unmount without showing success", async () => {
    const finality = deferred<{ status: "SUCCESS" }>();
    mocks.poll.mockReturnValue(finality.promise);
    const view = await open();
    await choose();
    const signal = mocks.poll.mock.calls[0]![2] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
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
    view.rerender(<ContractCallButton {...props} actionKey="new-arguments" />);
    fireEvent.click(screen.getByRole("button", { name: /charge now/i }));
    await waitFor(() => expect(mocks.getWalletKit).toHaveBeenCalledTimes(2));
    await choose();
    await act(async () => oldSignature.resolve({ signedTxXdr: "stale-signature" }));
    expect(submit).not.toHaveBeenCalled();
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => newSignature.resolve({ signedTxXdr: "current-signature" }));
    expect(submit).toHaveBeenCalledExactlyOnceWith("current-signature");
    expect(onSuccess).toHaveBeenCalledOnce();
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
