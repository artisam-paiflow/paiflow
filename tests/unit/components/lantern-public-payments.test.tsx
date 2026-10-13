import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  Account,
  Keypair,
  Networks,
  SorobanDataBuilder,
  StrKey,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TriggerButton } from "@/components/deploy/trigger-button";
import { LanternWallet } from "@/components/deploy/lantern-wallet";
import { getWalletKit } from "@/components/deploy/wallet-kit";
import {
  prepareDepositInvocation,
  prepareDistributeInvocation,
  prepareTokenApproveInvocation,
  prepareWebhookDepositInvocation,
  prepareStreamerTopUpInvocation,
} from "@/lib/stellar/invoke";
import { trackWalletConnection } from "@/lib/wallet-tracking";
import { toast } from "sonner";
const mocks = vi.hoisted(() => ({
  frame: null as Window | null,
  poll: vi.fn(),
  fetch: vi.fn(),
  init: vi.fn(),
  sdk: vi.fn(),
  modal: vi.fn(),
  server: { getAccount: vi.fn(), simulateTransaction: vi.fn(), getLatestLedger: vi.fn() },
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => mocks.server,
  decodeContractAddress: (id: string) => StrKey.decodeContract(id),
}));
vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
vi.mock("@/lib/wallet-tracking", () => ({ trackWalletConnection: vi.fn() }));
vi.mock("@/lib/hooks/use-poll-tx-status", () => ({ usePollTxStatus: () => mocks.poll }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/components/deploy/lantern-wallet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/deploy/lantern-wallet")>();
  return {
    ...actual,
    trustedLanternOrigin: () => actual.trustedLanternOrigin(mocks.frame ?? undefined),
    selectLanternWallet: (network: "testnet" | "mainnet") =>
      mocks.frame ? new actual.LanternWallet(network, mocks.frame) : null,
  };
});
vi.mock("@walletconnect/sign-client", () => ({
  SignClient: class {
    static init = mocks.init;
  },
}));
vi.mock("@walletconnect/modal", () => ({
  WalletConnectModal: class {
    constructor() {
      mocks.modal();
    }
  },
}));
vi.mock("@creit.tech/stellar-wallets-kit", () => ({
  StellarWalletsKit: class {
    constructor() {
      mocks.sdk();
    }
    getAddress = async () => ({ address });
    setWallet() {}
    async signTransaction(xdr: string) {
      const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
      tx.sign(signer);
      return { signedTxXdr: tx.toXDR() };
    }
    async openModal(opts: {
      onWalletSelected: (wallet: { id: string; name: string }) => Promise<void>;
    }) {
      await opts.onWalletSelected({ id: "freighter", name: "Freighter" });
    }
  },
  WalletNetwork: { TESTNET: "testnet", PUBLIC: "mainnet" },
  FreighterModule: class {},
}));
vi.mock("@creit.tech/stellar-wallets-kit/modules/walletconnect.module", () => ({
  WalletConnectModule: class {},
  WalletConnectAllowedMethods: { SIGN: "stellar_signXDR" },
}));
let signer: Keypair;
let address: string;
const contract = StrKey.encodeContract(Buffer.alloc(32, 1));
const token = StrKey.encodeContract(Buffer.alloc(32, 2));
let origin = "https://android.golantern.xyz";
const triggerKey = "paiflow_trigger_pending:deployment-id:testnet";
const allowanceKey = "paiflow_allowance_pending:deployment-id:testnet";
type Kind = "distribute" | "deposit" | "webhook" | "streamer" | "allowance";
let envelope: string;
let hash: string;
let network = "TESTNET";
let rejectSign = false;
let holdIdentity = false;
let holdSigning = false;
let send: ReturnType<typeof vi.fn>;
let reply: (data: unknown) => void;
let listeners: Set<(event: MessageEvent) => void>;
function frame() {
  listeners = new Set();
  const parent = { postMessage: vi.fn() };
  reply = (data) =>
    listeners.forEach((fn) => fn({ data, source: parent, origin } as unknown as MessageEvent));
  parent.postMessage.mockImplementation((message: Record<string, unknown>) => {
    if (message.type === "lantern:getPublicKey") {
      if (!holdIdentity) reply({ type: "lantern:publicKey", publicKey: address, network });
    } else {
      reply({ type: "lantern:signing", id: message.id });
      if (holdSigning) return;
      if (rejectSign)
        reply({
          type: "lantern:signRejected",
          id: message.id,
          error: "User rejected",
          code: "user_rejected",
        });
      else {
        const tx = TransactionBuilder.fromXDR(message.xdr as string, Networks.TESTNET);
        tx.sign(signer);
        reply({ type: "lantern:xdrSigned", id: message.id, signedXdr: tx.toXDR() });
      }
    }
  });
  send = parent.postMessage;
  mocks.frame = {
    parent,
    location: { ancestorOrigins: [origin] },
    document: { referrer: `${origin}/apps` },
    addEventListener: (_type: string, fn: (event: MessageEvent) => void) => listeners.add(fn),
    removeEventListener: (_type: string, fn: (event: MessageEvent) => void) => listeners.delete(fn),
  } as unknown as Window;
}
async function fixture(kind: Kind) {
  const common = { contractAddress: contract, amount: "200", invokerAddress: address };
  const data =
    kind === "allowance"
      ? await prepareTokenApproveInvocation({
          tokenContractAddress: token,
          from: address,
          spender: contract,
          amount: "200",
        })
      : kind === "webhook"
        ? await prepareWebhookDepositInvocation({
            contractAddress: contract,
            amount: "200",
            from: address,
          })
        : await {
            distribute: prepareDistributeInvocation,
            deposit: prepareDepositInvocation,
            streamer: prepareStreamerTopUpInvocation,
          }[kind](common);
  envelope = data.xdr;
  const tx = TransactionBuilder.fromXDR(envelope, Networks.TESTNET);
  expect(tx).toBeInstanceOf(Transaction); // Lantern refuses fee-bump envelopes.
  expect((tx as Transaction).source).toBe(address); // Lantern requires user tx/op source.
  expect(tx.operations[0]?.type).toBe("invokeHostFunction");
  hash = tx.hash().toString("hex");
  mocks.fetch.mockImplementation(async (_url: string, options: { body: string }) => {
    if (JSON.parse(options.body).signedXdr) {
      // Pending hash/intent must exist before the first bytes can be sent.
      expect(
        JSON.parse(localStorage.getItem(kind === "allowance" ? allowanceKey : triggerKey)!).txHash,
      ).toBe(hash);
      return { ok: true, json: async () => ({ data: { txHash: hash } }) };
    }
    return {
      ok: true,
      json: async () => ({
        data: {
          xdr: envelope,
          networkPassphrase: Networks.TESTNET,
          txHash: hash,
          receipt: "scoped.receipt",
          intent: "scoped.intent",
        },
      }),
    };
  });
}
function mount(kind: Kind = "distribute", extra: Record<string, unknown> = {}) {
  return render(
    <TriggerButton
      deploymentId="deployment-id"
      network="testnet"
      amount="200"
      isDeposit={kind === "deposit"}
      mode={kind === "allowance" ? "allowance" : "trigger"}
      templateKind={kind === "allowance" ? "SUBSCRIPTION" : undefined}
      {...extra}
    />,
  );
}
async function tap() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
  });
}
async function flush() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}
beforeEach(() => {
  // jsdom and Node have distinct typed-array realms; SDK noble checks instanceof.
  vi.stubGlobal("Uint8Array", Object.getPrototypeOf(Buffer.prototype).constructor);
  signer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 11));
  address = signer.publicKey();
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  network = "TESTNET";
  rejectSign = false;
  holdIdentity = false;
  holdSigning = false;
  origin = "https://android.golantern.xyz";
  frame();
  vi.stubEnv("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", "configured-project-id");
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("fetch", mocks.fetch);
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request: vi.fn(async (_key, _opts, action) => action({})) },
  });
  mocks.poll.mockResolvedValue({ status: "SUCCESS" });
  mocks.server.getAccount.mockImplementation(async () => new Account(address, "1"));
  mocks.server.getLatestLedger.mockResolvedValue({ sequence: 1000 });
  mocks.server.simulateTransaction.mockResolvedValue({
    _parsed: true,
    id: "1",
    latestLedger: 1000,
    events: [],
    transactionData: new SorobanDataBuilder().setResourceFee("1000"),
    minResourceFee: "1000",
    result: { auth: [], retval: nativeToScVal(true) },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Lantern public testnet payments with server-prepared Soroban envelopes", () => {
  it.each<Kind>(["distribute", "deposit", "webhook", "streamer", "allowance"])(
    "signs and submits %s through existing routes without browser wallet SDKs",
    async (kind) => {
      await fixture(kind);
      sessionStorage.setItem(
        "paiflow_pending_wc",
        JSON.stringify({ network: "testnet", timestamp: Date.now(), walletId: "freighter" }),
      );
      const open = vi.spyOn(window, "open");
      mount(kind);
      await tap();
      expect(mocks.init).not.toHaveBeenCalled();
      expect(mocks.sdk).not.toHaveBeenCalled();
      expect(mocks.modal).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(screen.queryByText("Select Wallet")).toBeNull();
      expect(mocks.fetch.mock.calls.map(([path]) => path)).toEqual(
        kind === "allowance"
          ? [
              "/api/deployments/deployment-id/subscription-allowance",
              "/api/deployments/deployment-id/subscription-allowance/submit",
            ]
          : [
              "/api/deployments/deployment-id/trigger",
              "/api/deployments/deployment-id/submit-trigger",
            ],
      );
      expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body).userAddress).toBe(address);
      const sent = JSON.parse(mocks.fetch.mock.calls[1]![1].body);
      const signed = TransactionBuilder.fromXDR(sent.signedXdr, Networks.TESTNET);
      expect(signed.hash().toString("hex")).toBe(hash);
      expect(signer.verify(signed.hash(), signed.signatures[0]!.signature())).toBe(true);
      expect(trackWalletConnection).toHaveBeenCalledWith({
        address,
        network: "testnet",
        walletId: "lantern",
        surface: "trigger",
      });
      expect(localStorage.getItem(kind === "allowance" ? allowanceKey : triggerKey)).toBeNull();
      expect(listeners.size).toBe(0);
      open.mockRestore();
    },
  );
  it.each<Kind>(["distribute", "allowance"])("does not submit %s after rejection", async (kind) => {
    await fixture(kind);
    rejectSign = true;
    mount(kind);
    await tap();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });
  it("rejects a Lantern network mismatch before preparing", async () => {
    network = "PUBLIC";
    mount();
    await tap();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.init).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });
  it("refuses embedded mainnet before prewarm/session restore/navigation", async () => {
    sessionStorage.setItem(
      "paiflow_pending_wc",
      JSON.stringify({ network: "mainnet", timestamp: Date.now() }),
    );
    mount("distribute", { network: "mainnet" });
    await tap();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Testnet only"));
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.sdk).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    await expect(getWalletKit("mainnet", { publicPayment: true })).rejects.toThrow("Testnet only");
  });
  it.each<Kind>(["distribute", "allowance"])(
    "retains %s uncertainty and reconciles after reload without signing again",
    async (kind) => {
      await fixture(kind);
      mocks.poll.mockRejectedValue(new Error("Timeout"));
      const view = mount(kind);
      await tap();
      const key = kind === "allowance" ? allowanceKey : triggerKey;
      expect(JSON.parse(localStorage.getItem(key)!).txHash).toBe(hash);
      expect(screen.getByRole("status").textContent).toContain("still unknown");
      await tap();
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
      view.unmount();
      frame();
      send.mockClear();
      mocks.fetch.mockClear();
      mocks.poll.mockResolvedValue({ status: "SUCCESS" });
      await act(async () => {
        mount(kind);
      });
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      expect(localStorage.getItem(key)).toBeNull();
    },
  );
  it("reconciles a lost trigger submit response against the original prepared receipt", async () => {
    await fixture("distribute");
    mocks.fetch
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          data: {
            xdr: envelope,
            networkPassphrase: Networks.TESTNET,
            txHash: hash,
            receipt: "scoped.receipt",
          },
        }),
      }))
      .mockRejectedValueOnce(new Error("Lost response"));
    mount();
    await tap();
    expect(mocks.poll).toHaveBeenCalledWith(
      "deployment-id",
      hash,
      expect.any(AbortSignal),
      expect.stringContaining("receipt=scoped.receipt"),
    );
    expect(localStorage.getItem(triggerKey)).toBeNull();
  });
  it("joins duplicate clicks while Lantern connection is pending", async () => {
    await fixture("distribute");
    holdIdentity = true;
    mount();
    await act(async () => {
      const button = screen.getByRole("button", { name: /connect wallet/i });
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(send).toHaveBeenCalledOnce();
    holdIdentity = false;
    reply({ type: "lantern:publicKey", publicKey: address, network });
    await flush();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["unmount", "deployment", "amount", "network", "mode"])(
    "cancels signing on %s and makes late replies inert",
    async (change) => {
      await fixture("distribute");
      holdSigning = true;
      const view = mount();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
      });
      const sign = send.mock.calls.find(([message]) => message.type === "lantern:signXdr")![0];
      if (change === "unmount") view.unmount();
      else
        view.rerender(
          <TriggerButton
            deploymentId={change === "deployment" ? "other-id" : "deployment-id"}
            network={change === "network" ? "mainnet" : "testnet"}
            amount={change === "amount" ? "500" : "200"}
            mode={change === "mode" ? "allowance" : "trigger"}
          />,
        );
      const tx = TransactionBuilder.fromXDR(sign.xdr, Networks.TESTNET);
      tx.sign(signer);
      reply({ type: "lantern:xdrSigned", id: sign.id, signedXdr: tx.toXDR() });
      await flush();
      expect(mocks.fetch).toHaveBeenCalledOnce();
      expect(mocks.poll).not.toHaveBeenCalled();
      expect(listeners.size).toBe(0);
    },
  );
  it("returns the explicit public transport from getWalletKit without initializing SDKs", async () => {
    const { kit, client, module } = await getWalletKit("testnet", { publicPayment: true });
    expect(kit.id).toBe("lantern");
    expect(await kit.getAddress()).toEqual({ address });
    kit.disconnect();
    expect(client).toBeNull();
    expect(module).toBeNull();
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.sdk).not.toHaveBeenCalled();
  });
  it("rejects a prepared passphrase mismatch without signing or submitting", async () => {
    await fixture("distribute");
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          xdr: envelope,
          networkPassphrase: Networks.PUBLIC,
          txHash: hash,
          receipt: "receipt",
        },
      }),
    });
    mount();
    await tap();
    expect(send.mock.calls.some(([message]) => message.type === "lantern:signXdr")).toBe(false);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(localStorage.getItem(triggerKey)).toBeNull();
  });
  it("cancels a delayed preparation on scope change before requesting a signature", async () => {
    await fixture("distribute");
    let finish!: (value: unknown) => void;
    mocks.fetch.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = mount();
    await tap();
    view.rerender(<TriggerButton deploymentId="other-id" network="testnet" amount="500" />);
    finish({
      ok: true,
      json: async () => ({
        data: {
          xdr: envelope,
          networkPassphrase: Networks.TESTNET,
          txHash: hash,
          receipt: "receipt",
        },
      }),
    });
    await flush();
    expect(send.mock.calls.some(([message]) => message.type === "lantern:signXdr")).toBe(false);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });
  it("cancels a pending connection on unmount and ignores later approval", async () => {
    holdIdentity = true;
    const view = mount();
    await tap();
    expect(listeners.size).toBe(1);
    view.unmount();
    reply({ type: "lantern:publicKey", publicKey: address, network });
    await flush();
    expect(listeners.size).toBe(0);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("keeps Payroll on the existing protected browser-wallet routes", async () => {
    await fixture("allowance");
    vi.stubEnv("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", "");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { xdr: envelope, txHash: hash, networkPassphrase: Networks.TESTNET },
      }),
    });
    mocks.frame = null; // Standalone Payroll retains its session-protected browser transport.
    mount("allowance", { templateKind: "PAYROLL" });
    await tap();
    expect(send).not.toHaveBeenCalled();
    expect(mocks.sdk).toHaveBeenCalledOnce();
    expect(mocks.fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/deployments/deployment-id/payroll-allowance",
      "/api/deployments/deployment-id/submit-invoke",
    ]);
  });
  it("keeps default authenticated getWalletKit calls on browser wallets in standalone tabs", async () => {
    mocks.frame = null;
    vi.stubEnv("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", "");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const result = await getWalletKit("mainnet");
    expect(result.kit.id).toBeUndefined();
    expect(mocks.sdk).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });
  it("uses the same embedded transport on the approved extension origin on desktop", async () => {
    origin = "chrome-extension://iflpkjgolcbleombhldiibhojohjpnmd";
    frame();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    await fixture("distribute");
    mount();
    await tap();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "lantern:signXdr" }), origin);
    expect(mocks.sdk).not.toHaveBeenCalled();
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it("refuses Payroll wallet actions inside Lantern without prewarming/restoring/deep links", async () => {
    sessionStorage.setItem(
      "paiflow_pending_wc",
      JSON.stringify({ network: "testnet", timestamp: Date.now() }),
    );
    const open = vi.spyOn(window, "open");
    mount("allowance", { templateKind: "PAYROLL" });
    await tap();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("authenticated-app milestone"),
    );
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.sdk).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
  it("refuses default authenticated getWalletKit calls in Lantern before SDK/cache access", async () => {
    await expect(getWalletKit("testnet")).rejects.toThrow("not enabled yet");
    await expect(getWalletKit("mainnet")).rejects.toThrow("not enabled yet");
    expect(mocks.sdk).not.toHaveBeenCalled();
    expect(mocks.init).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
