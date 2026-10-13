import { act, fireEvent, render, screen } from "@testing-library/react";
import { Account, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TriggerButton } from "@/components/deploy/trigger-button";
type Picker = {
  onWalletSelected: (wallet: { id: string; name: string }) => Promise<void>;
  onClosed: () => void;
};
const mocks = vi.hoisted(() => ({
  sign: vi.fn(),
  poll: vi.fn(),
  fetch: vi.fn(),
  wallet: vi.fn(),
  address: vi.fn(),
  init: vi.fn(),
  setSession: vi.fn(),
  options: [] as Picker[],
  networks: [] as string[],
}));
vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
vi.mock("@/lib/wallet-tracking", () => ({ trackWalletConnection: vi.fn() }));
vi.mock("@/lib/hooks/use-poll-tx-status", () => ({ usePollTxStatus: () => mocks.poll }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock("@walletconnect/modal", () => ({ WalletConnectModal: class {} }));
vi.mock("@walletconnect/sign-client", () => ({
  SignClient: class {
    static init = mocks.init;
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
    constructor({ network }: { network: string }) {
      mocks.networks.push(network);
    }
    getAddress = mocks.address;
    signTransaction = mocks.sign;
    setWallet() {}
    async openModal(opts: Picker) {
      // Installed v1 resolves after opening, before selection/close events.
      mocks.wallet();
      mocks.options.push(opts);
    }
  },
  FreighterModule: class {},
  WalletNetwork: { TESTNET: "testnet", PUBLIC: "mainnet" },
}));
const unsigned =
  "AAAAAgAAAAAqqwPzVFoYWmeHNnMvv3tSlKObApP5/F8Iz4wq34IZ2AAAAGQAAAAAAAAAAgAAAAEAAAAAAAAAAAAAAABqzajRAAAAAAAAAAEAAAAAAAAACgAAAAR0ZXN0AAAAAQAAAAExAAAAAAAAAAAAAAA=";
const signed =
  "AAAAAgAAAAAqqwPzVFoYWmeHNnMvv3tSlKObApP5/F8Iz4wq34IZ2AAAAGQAAAAAAAAAAgAAAAEAAAAAAAAAAAAAAABqzajRAAAAAAAAAAEAAAAAAAAACgAAAAR0ZXN0AAAAAQAAAAExAAAAAAAAAAAAAAHfghnYAAAAQPHwM+Oye1tB1BhLxb66oQPW0k+v2KB4zcLRr7+A2uzw5gcaUJvQH1ENE1TTLzx00uip0TkgRo7Ybu7OQWAU+Qw=";
const hash = "a3a8536416651dc01dd0d9445f1d12d7909883533aacb0741d84ddb0cbf51301";
const key = "paiflow_trigger_pending:deployment-id:testnet";
const prepared = {
  ok: true,
  json: async () => ({
    data: {
      xdr: unsigned,
      txHash: hash,
      receipt: "scoped.receipt",
      networkPassphrase: Networks.TESTNET,
    },
  }),
};
const locks = {
  request: vi.fn(
    async (_key: string, _options: unknown, action: (lock: object | null) => Promise<void>) =>
      action({}),
  ),
};
function mount(
  props: {
    amount?: string;
    deploymentId?: string;
    network?: "testnet" | "mainnet";
    isDeposit?: boolean;
    mode?: "trigger" | "allowance";
    templateKind?: "SUBSCRIPTION" | "PAYROLL";
  } = {},
) {
  return render(
    <TriggerButton deploymentId="deployment-id" network="testnet" amount="200" {...props} />,
  );
}
async function openPicker() {
  await act(async () => {
    fireEvent.click(
      screen.getAllByRole("button", { name: /connect wallet & (trigger|deposit)/i })[0]!,
    );
  });
}
async function selectPicker(index = mocks.options.length - 1) {
  await act(async () => {
    await mocks.options[index]!.onWalletSelected({ id: "freighter", name: "Freighter" });
  });
}
async function pay() {
  await openPicker();
  if (!mocks.options.length) return;
  if (mocks.wallet.mock.results.at(-1)?.value === "cancel") {
    await act(async () => mocks.options.at(-1)!.onClosed());
  }
  await selectPicker();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal("Uint8Array", Object.getPrototypeOf(Buffer.prototype).constructor);
  vi.clearAllMocks();
  mocks.wallet.mockReset();
  mocks.options.length = 0;
  mocks.networks.length = 0;
  mocks.address.mockReset().mockResolvedValue({ address: "GADDRESS" });
  mocks.init.mockReset().mockResolvedValue({ session: { values: [] } });
  localStorage.clear();
  sessionStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", "");
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("fetch", mocks.fetch);
  Object.defineProperty(navigator, "locks", { configurable: true, value: locks });
  locks.request.mockImplementation(async (_key, _options, action) => action({}));
  mocks.sign.mockResolvedValue({ signedTxXdr: signed });
  mocks.poll.mockResolvedValue({ status: "SUCCESS" });
  mocks.fetch.mockReset().mockResolvedValue(prepared);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("public trigger hash reconciliation", () => {
  it("durably saves the prepared hash before sending, without persisting the envelope", async () => {
    mocks.fetch.mockImplementation(async (path: string) => {
      if (path.endsWith("submit-trigger")) {
        expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
          txHash: hash,
          receipt: "scoped.receipt",
        });
        expect(localStorage.getItem(key)).not.toContain(signed);
      }
      return prepared;
    });
    mount();
    await pay();
    expect(mocks.fetch.mock.calls.map((c) => c[0])).toEqual([
      "/api/deployments/deployment-id/trigger",
      "/api/deployments/deployment-id/submit-trigger",
    ]);
    expect(mocks.poll).toHaveBeenCalledWith(
      "deployment-id",
      hash,
      expect.any(AbortSignal),
      expect.stringContaining("receipt=scoped.receipt"),
    );
    expect(localStorage.getItem(key)).toBeNull();
  });
  it.each(["lost response", "502", "403", "invalid response body"])(
    "reconciles %s against the original hash",
    async (scenario) => {
      mocks.fetch.mockResolvedValueOnce(prepared);
      if (scenario === "lost response")
        mocks.fetch.mockRejectedValueOnce(new Error("Lost response"));
      else
        mocks.fetch.mockResolvedValueOnce({
          ok: false,
          status: scenario === "403" ? 403 : 502,
          json: async () => {
            throw new Error("not JSON");
          },
        });
      mount();
      await pay();
      expect(mocks.poll).toHaveBeenCalledWith(
        "deployment-id",
        hash,
        expect.any(AbortSignal),
        expect.any(String),
      );
      expect(screen.getByRole("status").textContent).toContain("Payment confirmed");
      expect(mocks.sign).toHaveBeenCalledOnce();
    },
  );
  it("blocks a second amount after timeout and reconciles on reload, before WalletConnect resume", async () => {
    mocks.poll.mockRejectedValue(new Error("timeout"));
    const view = mount();
    await pay();
    expect(screen.getByRole("status").textContent).toContain("still unknown");
    expect(
      (screen.getByRole("button", { name: /connect wallet & trigger/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    view.unmount();
    mocks.fetch.mockClear();
    mocks.sign.mockClear();
    mocks.wallet.mockClear();
    sessionStorage.setItem(
      "paiflow_pending_wc",
      JSON.stringify({ network: "testnet", timestamp: Date.now() }),
    );
    mocks.poll.mockResolvedValue({ status: "SUCCESS" });
    await act(async () => {
      mount({ amount: "500" });
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.wallet).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBeNull();
  });
  it.each(["FAILED", "SUCCESS"])("releases after authoritative %s", async (status) => {
    mocks.poll.mockResolvedValue({ status });
    mount({ isDeposit: true });
    await pay();
    expect(localStorage.getItem(key)).toBeNull();
    expect(
      (screen.getByRole("button", { name: /connect wallet & deposit/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
  it("does not submit or persist after wallet rejection", async () => {
    mocks.sign.mockRejectedValue(new Error("Rejected"));
    mount();
    await pay();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("refuses to send when durable storage fails", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Quota exceeded");
    });
    try {
      mount();
      await pay();
      expect(mocks.fetch).toHaveBeenCalledOnce();
      expect(mocks.poll).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
  it("fails closed without Web Locks or when another tab owns the lock", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    mount();
    await pay();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("does not prepare when another tab owns the Web Lock", async () => {
    locks.request.mockImplementation(async (_key, _options, action) => action(null));
    mount();
    await pay();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("excludes overlapping component instances while signing and after uncertain finality", async () => {
    let finish!: (v: { signedTxXdr: string }) => void;
    mocks.sign.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mocks.poll.mockRejectedValue(new Error("timeout"));
    mount();
    mount({ amount: "300" });
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /connect wallet & trigger/i })[0]!);
    });
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /connect wallet & trigger/i })[0]!);
    });
    await act(async () => {
      void mocks.options[0]!.onWalletSelected({ id: "freighter", name: "Freighter" });
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.sign).toHaveBeenCalledOnce();
    await act(async () => {
      finish({ signedTxXdr: signed });
    });
    expect(
      screen
        .getAllByRole("button", { name: /connect wallet & trigger/i })
        .every((b) => (b as HTMLButtonElement).disabled),
    ).toBe(true);
  });
  it("ignores other deployment/network records and preserves corrupt records fail closed", async () => {
    localStorage.setItem(key, "invalid");
    await act(async () => {
      mount();
    });
    expect(
      (screen.getByRole("button", { name: /connect wallet & trigger/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(localStorage.getItem(key)).toBe("invalid");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("a different deployment can proceed without touching an unresolved payment", async () => {
    localStorage.setItem(key, JSON.stringify({ txHash: hash }));
    mount({ deploymentId: "other-id" });
    await pay();
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/deployments/other-id/trigger",
      expect.anything(),
    );
    expect(localStorage.getItem(key)).not.toBeNull();
  });
  it("ignores a wallet selection callback that arrives after picker cancellation", async () => {
    mocks.wallet.mockReturnValue("cancel");
    mount();
    await pay();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("blocks duplicate clicks before React updates the busy button", async () => {
    mount();
    const button = screen.getByRole("button", { name: /connect wallet & trigger/i });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await selectPicker();
    expect(mocks.options).toHaveLength(1);
    expect(mocks.sign).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it("stops a changed signed envelope before storing or submitting", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          xdr: unsigned,
          txHash: "a".repeat(64),
          receipt: "scoped.receipt",
          networkPassphrase: Networks.TESTNET,
        },
      }),
    });
    mount();
    await pay();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(localStorage.getItem(key)).toBeNull();
    expect(mocks.poll).not.toHaveBeenCalled();
  });
  it("does not send after unmount while the signature is pending", async () => {
    let finish!: (v: { signedTxXdr: string }) => void;
    mocks.sign.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /connect wallet & trigger/i }));
    });
    await act(async () => {
      void mocks.options[0]!.onWalletSelected({ id: "freighter", name: "Freighter" });
    });
    view.unmount();
    await act(async () => {
      finish({ signedTxXdr: signed });
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("a status retry never reconnects, signs, prepares or resubmits", async () => {
    mocks.poll.mockRejectedValue(new Error("timeout"));
    mount();
    await pay();
    mocks.fetch.mockClear();
    mocks.sign.mockClear();
    mocks.wallet.mockClear();
    mocks.poll.mockResolvedValue({
      status: "FAILED",
      errorMessage: "Payment expired without confirmation",
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /check payment status/i }));
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.wallet).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("checks legacy hashes without inventing expiry evidence", async () => {
    localStorage.setItem(key, JSON.stringify({ txHash: hash }));
    mocks.poll.mockRejectedValue(new Error("timeout"));
    await act(async () => {
      mount();
    });
    expect(mocks.poll).toHaveBeenCalledWith(
      "deployment-id",
      hash,
      expect.any(AbortSignal),
      undefined,
    );
    expect(localStorage.getItem(key)).not.toBeNull();
  });
});

describe("asynchronous desktop picker lifetime", () => {
  it.each([
    { deploymentId: "other-id" },
    { network: "mainnet" as const },
    { mode: "allowance" as const },
    { amount: "500" },
    { templateKind: "PAYROLL" as const },
    { isDeposit: true },
  ])("ignores selection after payment intent changes: %j", async (changed) => {
    const view = mount();
    await openPicker();
    expect(mocks.options).toHaveLength(1);
    view.rerender(
      <TriggerButton deploymentId="deployment-id" network="testnet" amount="200" {...changed} />,
    );
    await selectPicker(0);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("ignores selection and close after unmount", async () => {
    const view = mount();
    await openPicker();
    view.unmount();
    await selectPicker(0);
    await act(async () => mocks.options[0]!.onClosed());
    expect(mocks.address).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("stays busy after openModal returns until the chosen payment finishes", async () => {
    const signature = deferred<{ signedTxXdr: string }>();
    const status = deferred<{ status: string }>();
    mocks.sign.mockReturnValue(signature.promise);
    mocks.poll.mockReturnValue(status.promise);
    let lockHeld = false;
    locks.request.mockImplementation(async (_key, _opts, action) => {
      lockHeld = true;
      try {
        await action({});
      } finally {
        lockHeld = false;
      }
    });
    mount();
    await openPicker();
    expect(screen.getByRole("button", { name: /processing/i }).hasAttribute("disabled")).toBe(true);
    let selection!: Promise<void>;
    await act(async () => {
      selection = mocks.options[0]!.onWalletSelected({ id: "freighter", name: "Freighter" });
    });
    expect(lockHeld).toBe(true);
    // A late close or duplicate selection must not cancel this payment.
    await act(async () => {
      mocks.options[0]!.onClosed();
      await mocks.options[0]!.onWalletSelected({ id: "freighter", name: "Freighter" });
      signature.resolve({ signedTxXdr: signed });
    });
    expect(mocks.sign).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(lockHeld).toBe(true);
    expect(screen.getByRole("button", { name: /processing/i }).hasAttribute("disabled")).toBe(true);
    await act(async () => {
      status.resolve({ status: "SUCCESS" });
      await selection;
    });
    expect(lockHeld).toBe(false);
    expect(
      screen.getByRole("button", { name: /connect wallet & trigger/i }).hasAttribute("disabled"),
    ).toBe(false);
  });
  it("old close and selection cannot cancel a newer picker", async () => {
    mount();
    await openPicker();
    await act(async () => mocks.options[0]!.onClosed());
    await openPicker();
    expect(mocks.options).toHaveLength(2);
    await act(async () => mocks.options[0]!.onClosed());
    await selectPicker(0);
    expect(screen.getByRole("button", { name: /processing/i }).hasAttribute("disabled")).toBe(true);
    expect(mocks.fetch).not.toHaveBeenCalled();
    await selectPicker(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.sign).toHaveBeenCalledOnce();
  });
  it.each(["scope change", "unmount"])(
    "does not prepare after delayed getAddress and %s",
    async (change) => {
      const address = deferred<{ address: string }>();
      mocks.address.mockReturnValue(address.promise);
      const view = mount();
      await openPicker();
      let selection!: Promise<void>;
      await act(async () => {
        selection = mocks.options[0]!.onWalletSelected({ id: "freighter", name: "Freighter" });
      });
      if (change === "unmount") view.unmount();
      else view.rerender(<TriggerButton deploymentId="other-id" network="testnet" amount="500" />);
      await act(async () => {
        address.resolve({ address: "GADDRESS" });
        await selection;
      });
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(mocks.sign).not.toHaveBeenCalled();
    },
  );
  it.each(["scope change", "unmount"])(
    "does not open a picker after delayed SDK initialization and %s",
    async (change) => {
      vi.stubEnv("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", "project");
      const initialized = deferred<{ session: { values: [] } }>();
      mocks.init.mockReturnValue(initialized.promise);
      const view = mount();
      await openPicker();
      expect(mocks.init).toHaveBeenCalledOnce();
      if (change === "unmount") view.unmount();
      else view.rerender(<TriggerButton deploymentId="other-id" network="testnet" amount="500" />);
      await act(async () => {
        initialized.resolve({ session: { values: [] } });
      });
      expect(mocks.options).toHaveLength(0);
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );
  it("initializes a new wallet kit for a new network", async () => {
    const view = mount();
    await openPicker();
    await act(async () => mocks.options[0]!.onClosed());
    view.rerender(<TriggerButton deploymentId="deployment-id" network="mainnet" amount="200" />);
    await openPicker();
    expect(mocks.networks).toEqual(["testnet", "mainnet"]);
    await selectPicker(0);
    expect(mocks.fetch).not.toHaveBeenCalled();
    await act(async () => mocks.options[1]!.onClosed());
  });
  it("old getAddress completion cannot finish a newer attempt", async () => {
    const address = deferred<{ address: string }>();
    mocks.address.mockReturnValueOnce(address.promise);
    const view = mount();
    await openPicker();
    let old!: Promise<void>;
    await act(async () => {
      old = mocks.options[0]!.onWalletSelected({ id: "freighter", name: "Freighter" });
    });
    view.rerender(<TriggerButton deploymentId="other-id" network="testnet" amount="500" />);
    await openPicker();
    await act(async () => {
      address.resolve({ address: "GADDRESS" });
      await old;
      mocks.options[0]!.onClosed();
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /processing/i }).hasAttribute("disabled")).toBe(true);
    await selectPicker(1);
    expect(mocks.fetch.mock.calls[0]![0]).toBe("/api/deployments/other-id/trigger");
    expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body).amount).toBe("500");
    expect(mocks.sign).toHaveBeenCalledOnce();
  });
  it("does not sign after a preparation response arrives for a stale intent", async () => {
    const preparation = deferred<typeof prepared>();
    mocks.fetch.mockReturnValue(preparation.promise);
    const view = mount();
    await openPicker();
    let selection!: Promise<void>;
    await act(async () => {
      selection = mocks.options[0]!.onWalletSelected({ id: "freighter", name: "Freighter" });
    });
    view.rerender(<TriggerButton deploymentId="deployment-id" network="testnet" amount="500" />);
    await act(async () => {
      preparation.resolve(prepared);
      await selection;
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("does not submit a signature returned after an intent change", async () => {
    const signature = deferred<{ signedTxXdr: string }>();
    mocks.sign.mockReturnValue(signature.promise);
    const view = mount();
    await openPicker();
    let selection!: Promise<void>;
    await act(async () => {
      selection = mocks.options[0]!.onWalletSelected({ id: "freighter", name: "Freighter" });
    });
    view.rerender(<TriggerButton deploymentId="deployment-id" network="mainnet" amount="500" />);
    await act(async () => {
      signature.resolve({ signedTxXdr: signed });
      await selection;
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("retains the original pending hash when scope changes after send", async () => {
    const submitted = deferred<typeof prepared>();
    mocks.fetch.mockResolvedValueOnce(prepared).mockReturnValueOnce(submitted.promise);
    const view = mount();
    await openPicker();
    let selection!: Promise<void>;
    await act(async () => {
      selection = mocks.options[0]!.onWalletSelected({ id: "freighter", name: "Freighter" });
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    view.rerender(<TriggerButton deploymentId="other-id" network="testnet" amount="500" />);
    await act(async () => {
      submitted.resolve(prepared);
      await selection;
    });
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
      txHash: hash,
      receipt: "scoped.receipt",
    });
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => {
      view.rerender(<TriggerButton deploymentId="deployment-id" network="testnet" amount="500" />);
    });
    expect(mocks.poll).toHaveBeenCalledOnce();
    expect(localStorage.getItem(key)).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("wallet initialization and mobile pairing generations", () => {
  it("a delayed old initialization cannot cache or reopen the previous network kit", async () => {
    vi.stubEnv("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", "project");
    const oldInit = deferred<{ session: { values: [] } }>();
    mocks.init
      .mockReturnValueOnce(oldInit.promise)
      .mockResolvedValueOnce({ session: { values: [] } });
    const view = mount();
    await openPicker();
    view.rerender(<TriggerButton deploymentId="deployment-id" network="mainnet" amount="500" />);
    await openPicker();
    expect(mocks.networks).toEqual(["mainnet"]);
    expect(mocks.options).toHaveLength(1);
    await act(async () => {
      oldInit.resolve({ session: { values: [] } });
    });
    expect(mocks.networks).toEqual(["mainnet"]);
    expect(mocks.options).toHaveLength(1);
    expect(screen.getByRole("button", { name: /processing/i }).hasAttribute("disabled")).toBe(true);
    await act(async () => mocks.options[0]!.onClosed());
    await openPicker();
    expect(mocks.init).toHaveBeenCalledTimes(2);
    expect(mocks.networks).toEqual(["mainnet"]);
    await act(async () => mocks.options[1]!.onClosed());
  });
  it("an old mobile pairing cannot replace the new network pairing", async () => {
    vi.stubEnv("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", "project");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    type Pairing = { uri: string; approval: () => Promise<{ topic: string }> };
    const oldPair = deferred<Pairing>();
    const newPair = deferred<Pairing>();
    const approval = deferred<{ topic: string }>();
    const oldConnect = vi.fn().mockReturnValue(oldPair.promise);
    const newConnect = vi.fn().mockReturnValue(newPair.promise);
    mocks.init
      .mockResolvedValueOnce({ session: { values: [] }, connect: oldConnect })
      .mockResolvedValueOnce({ session: { values: [] }, connect: newConnect });
    const view = mount();
    await act(async () => {});
    expect(oldConnect).toHaveBeenCalledOnce();
    view.rerender(<TriggerButton deploymentId="deployment-id" network="mainnet" amount="500" />);
    await act(async () => {});
    expect(newConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        requiredNamespaces: expect.objectContaining({
          stellar: expect.objectContaining({ chains: ["stellar:pubnet"] }),
        }),
      }),
    );
    await act(async () => {
      oldPair.resolve({ uri: "wc:old", approval: () => approval.promise });
    });
    await openPicker();
    expect(screen.getByRole("button", { name: "Freighter" }).hasAttribute("disabled")).toBe(true);
    await act(async () => {
      newPair.resolve({ uri: "wc:new", approval: () => approval.promise });
    });
    expect(screen.getByRole("button", { name: "Freighter" }).hasAttribute("disabled")).toBe(false);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Freighter" }));
      });
      expect(open).toHaveBeenCalledWith(
        "freighterwallet://wc?uri=wc%3Anew",
        "_self",
        "noreferrer noopener",
      );
      view.unmount();
      await act(async () => {
        approval.resolve({ topic: "new" });
      });
      expect(mocks.address).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(mocks.setSession).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
    }
  });
  it("a mobile approval cannot continue after deployment changes", async () => {
    vi.stubEnv("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", "project");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const approval = deferred<{ topic: string }>();
    const connect = vi
      .fn()
      .mockResolvedValue({ uri: "wc:ready", approval: () => approval.promise });
    mocks.init.mockResolvedValue({ session: { values: [] }, connect });
    const view = mount();
    await act(async () => {});
    await openPicker();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Freighter" }));
      });
      view.rerender(<TriggerButton deploymentId="other-id" network="testnet" amount="500" />);
      await act(async () => {
        approval.resolve({ topic: "old" });
      });
      expect(mocks.address).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(mocks.setSession).not.toHaveBeenCalled();
      await openPicker();
      expect(screen.getByRole("button", { name: "Freighter" }).hasAttribute("disabled")).toBe(
        false,
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      });
      await openPicker();
      expect(screen.getByRole("button", { name: "Freighter" }).hasAttribute("disabled")).toBe(
        false,
      );
    } finally {
      open.mockRestore();
    }
  });
  it("valid mobile approval still prepares, signs and submits once", async () => {
    vi.stubEnv("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", "project");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const connect = vi
      .fn()
      .mockResolvedValue({ uri: "wc:ready", approval: async () => ({ topic: "valid" }) });
    mocks.init.mockResolvedValue({ session: { values: [] }, connect });
    mount();
    await act(async () => {});
    await openPicker();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Freighter" }));
      });
      expect(mocks.setSession).toHaveBeenCalledWith("valid");
      expect(mocks.sign).toHaveBeenCalledOnce();
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
      expect(localStorage.getItem(key)).toBeNull();
    } finally {
      open.mockRestore();
    }
  });
});
