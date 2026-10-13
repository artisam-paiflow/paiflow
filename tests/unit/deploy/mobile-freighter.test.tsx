import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { TriggerButton } from "@/components/deploy/trigger-button";

const mocks = vi.hoisted(() => ({
  address: "",
  connect: vi.fn(),
  setSession: vi.fn(),
  sign: vi.fn(),
  poll: vi.fn(),
  request: vi.fn(),
  sessions: [] as {
    topic: string;
    pairingTopic?: string;
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
    getAddress = async () => ({ address: mocks.address });
    signTransaction = mocks.sign;
    setWallet() {}
  },
  FreighterModule: class {},
  WalletNetwork: {
    TESTNET: "Test SDF Network ; September 2015",
    PUBLIC: "Public Global Stellar Network ; September 2015",
  },
}));

let unsigned: string;
let signed: string;
let wrongSigned: string;
let hash: string;
let originalLocks: PropertyDescriptor | undefined;
const pendingAtSubmit: (string | null)[] = [];
const pendingKey = "paiflow_trigger_pending:deposit-id:testnet";
const receipt = "scoped.preparation.receipt";
function preparation(networkPassphrase = Networks.TESTNET) {
  return {
    ok: true,
    json: async () => ({ data: { xdr: unsigned, networkPassphrase, txHash: hash, receipt } }),
  };
}
function submitted() {
  // The original hash and receipt must be durable before sending the envelope.
  pendingAtSubmit.push(localStorage.getItem(pendingKey));
  return { ok: true, json: async () => ({ data: { txHash: hash } }) };
}

describe("mobile Freighter deposit", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    pendingAtSubmit.length = 0;
    originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
    vi.stubGlobal("Uint8Array", Object.getPrototypeOf(Buffer.prototype).constructor);
    const signer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
    mocks.address = signer.publicKey();
    const transaction = new TransactionBuilder(new Account(signer.publicKey(), "1"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.manageData({ name: "mobile-regression", value: "payment" }))
      .setTimeout(300)
      .build();
    unsigned = transaction.toXDR();
    hash = transaction.hash().toString("hex");
    transaction.sign(signer);
    signed = transaction.toXDR();
    const different = new TransactionBuilder(new Account(signer.publicKey(), "2"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.manageData({ name: "mobile-regression", value: "different" }))
      .setTimeout(300)
      .build();
    different.sign(signer);
    wrongSigned = different.toXDR();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (_key: string, _options: unknown, action: (lock: object) => Promise<void>) =>
          action({}),
      },
    });
    // Settle lazy SDK imports under the registered mocks before prewarming.
    await Promise.all([
      import("@walletconnect/sign-client"),
      import("@walletconnect/modal"),
      import("@creit.tech/stellar-wallets-kit"),
      import("@creit.tech/stellar-wallets-kit/modules/walletconnect.module"),
    ]);
    vi.stubEnv("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", "test-project");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    sessionStorage.clear();
    localStorage.clear();
    mocks.sessions.length = 0;
  });

  afterEach(() => {
    if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks);
    else Reflect.deleteProperty(navigator, "locks");
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
        .mockResolvedValueOnce(preparation())
        .mockImplementationOnce(submitted);
      vi.stubGlobal("fetch", fetchMock);
      const open = vi.spyOn(window, "open").mockReturnValue(null);

      await act(async () => {
        render(
          <TriggerButton deploymentId="deposit-id" network="testnet" amount="10000000" isDeposit />,
        );
      });
      fireEvent.click(screen.getByRole("button", { name: /connect wallet & deposit/i }));
      await waitFor(() =>
        expect(
          (screen.getByRole("button", { name: "Freighter" }) as HTMLButtonElement).disabled,
        ).toBe(false),
      );
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
      expect(mocks.sign).toHaveBeenCalledWith(unsigned, {
        address: mocks.address,
        networkPassphrase: Networks.TESTNET,
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole("button", { name: /open freighter to sign/i }));
      expect(open).toHaveBeenLastCalledWith("freighterwallet://wc-redirect", "_self");

      await act(async () => {
        if (decision === "approve") approveSignature({ signedTxXdr: signed });
        else rejectSignature(new Error("User rejected the request"));
      });
      if (decision === "approve") {
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenLastCalledWith(
          "/api/deployments/deposit-id/submit-trigger",
          expect.objectContaining({ body: JSON.stringify({ signedXdr: signed }) }),
        );
        // Assert outside the transport mock: lost-response handling catches fetch errors.
        expect(pendingAtSubmit).toEqual([JSON.stringify({ txHash: hash, receipt })]);
        expect(mocks.poll).toHaveBeenCalledWith(
          "deposit-id",
          hash,
          expect.any(AbortSignal),
          `/api/deployments/deposit-id/tx-status?txHash=${hash}&receipt=${encodeURIComponent(receipt)}`,
        );
      } else {
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(mocks.poll).not.toHaveBeenCalled();
        expect(localStorage.getItem(pendingKey)).toBeNull();
      }
    },
  );

  it.each([
    "approve",
    "reject",
    "network mismatch",
    "missing signature",
    "disconnect",
    "changed transaction",
  ] as const)("reuses only the approved topic: %s", async (outcome) => {
    const address = mocks.address;
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
        outcome === "missing signature"
          ? {}
          : { signedXDR: outcome === "changed transaction" ? wrongSigned : signed },
      );
    mocks.poll.mockResolvedValue({ status: "SUCCESS" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        preparation(outcome === "network mismatch" ? Networks.PUBLIC : Networks.TESTNET),
      )
      .mockImplementationOnce(submitted);
    vi.stubGlobal("fetch", fetchMock);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await act(async () => {
      render(
        <TriggerButton deploymentId="deposit-id" network="testnet" amount="10000000" isDeposit />,
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /connect wallet & deposit/i }));
    });
    expect(screen.getByRole("button", { name: /send with G.+…/i }).title).toBe(address);
    expect(fetchMock).not.toHaveBeenCalled();
    if (outcome === "disconnect") mocks.sessions.splice(1, 1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send with G.+…/i }));
      // The native link must open before an async boundary loses Chrome's
      // user activation, without waiting for preparation or signing.
      expect(open).toHaveBeenCalledTimes(outcome === "disconnect" ? 0 : 1);
      expect(fetchMock).not.toHaveBeenCalled();
    });
    if (outcome === "disconnect") {
      expect(open).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Freighter" })).toBeTruthy();
      return;
    }
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith("freighterwallet://wc-redirect", "_self");
    expect(mocks.connect).not.toHaveBeenCalled();
    if (outcome === "network mismatch") {
      expect(mocks.request).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(mocks.poll).not.toHaveBeenCalled();
      expect(pendingAtSubmit).toEqual([]);
      expect(localStorage.getItem(pendingKey)).toBeNull();
      return;
    }
    expect(mocks.request).toHaveBeenCalledWith({
      topic: session.topic,
      chainId: "stellar:testnet",
      request: { method: "stellar_signXDR", params: { xdr: unsigned } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(outcome === "approve" ? 2 : 1);
    if (outcome === "approve") {
      expect(pendingAtSubmit).toEqual([JSON.stringify({ txHash: hash, receipt })]);
      expect(mocks.poll).toHaveBeenCalledWith(
        "deposit-id",
        hash,
        expect.any(AbortSignal),
        `/api/deployments/deposit-id/tx-status?txHash=${hash}&receipt=${encodeURIComponent(receipt)}`,
      );
    } else {
      expect(mocks.poll).not.toHaveBeenCalled();
      expect(localStorage.getItem(pendingKey)).toBeNull();
    }
  });

  it("remembers the exact newly approved pairing after reload instead of the older saved wallet", async () => {
    const address = mocks.address;
    const oldAddress = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
    const old = { topic: "old-topic", walletId: "lobstr", address: oldAddress };
    localStorage.setItem("paiflow_mobile_wallet:testnet", JSON.stringify(old));
    for (const [topic, pairingTopic, account] of [
      [old.topic, "old-pairing", oldAddress],
      ["resumed-topic", "new-pairing", address],
    ])
      mocks.sessions.push({
        topic: topic!,
        pairingTopic,
        expiry: Math.floor(Date.now() / 1000) + 3600,
        namespaces: {
          stellar: { accounts: [`stellar:testnet:${account}`], methods: ["stellar_signXDR"] },
        },
      });
    sessionStorage.setItem(
      "paiflow_pending_wc",
      JSON.stringify({
        network: "testnet",
        timestamp: Date.now(),
        walletId: "freighter",
        pairingTopic: "new-pairing",
      }),
    );
    mocks.sign.mockResolvedValue({ signedTxXdr: signed });
    mocks.poll.mockResolvedValue({ status: "SUCCESS" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(preparation()).mockImplementationOnce(submitted),
    );
    await act(async () => {
      render(
        <TriggerButton deploymentId="deposit-id" network="testnet" amount="10000000" isDeposit />,
      );
    });
    expect(mocks.setSession).toHaveBeenCalledWith("resumed-topic");
    expect(JSON.parse(localStorage.getItem("paiflow_mobile_wallet:testnet")!)).toEqual({
      topic: "resumed-topic",
      walletId: "freighter",
      address,
    });
    expect(sessionStorage.getItem("paiflow_pending_wc")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /connect wallet & deposit/i }));
    });
    expect(screen.getByRole("button", { name: /send with G.+…/i })).toBeTruthy();
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
