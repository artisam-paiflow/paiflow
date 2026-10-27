import {
  Account,
  Address,
  Keypair,
  Networks,
  nativeToScVal,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { friendlyError } from "@/lib/friendly-error";
import { LanternWalletError } from "@/lib/stellar/lantern-wallet-error";
import { LanternModule } from "@/components/deploy/lantern-module";

const signer = Keypair.random();
const other = Keypair.random();
const address = signer.publicKey();
const contract = Address.contract(Buffer.alloc(32, 1)).toString();
function transaction(source = address, amount = 100n) {
  return new TransactionBuilder(new Account(source, "41"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract,
        function: "deposit",
        args: [new Address(source).toScVal(), nativeToScVal(amount, { type: "i128" })],
      }),
    )
    .setTimeout(180)
    .build();
}
const getAddress = vi.fn();
const signTransaction = vi.fn();
const getNetwork = vi.fn();
const isConnected = vi.fn();
const requestAccess = vi.fn(() => getAddress());
const listeners = new Set<(data: Record<string, unknown>) => void>();
const provider = {
  isLantern: true,
  apiVersion: 1,
  isConnected,
  requestAccess,
  getAddress,
  getNetwork,
  signTransaction,
  on: vi.fn((_event, listener) => listeners.add(listener)),
  off: vi.fn((_event, listener) => listeners.delete(listener)),
};
function install(value: unknown) {
  (window as unknown as { lantern: unknown }).lantern = value;
}
function change(reason: string) {
  for (const listener of listeners) listener({ reason });
}
let module: LanternModule;
let unsignedXdr: string;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  requestAccess.mockImplementation(() => getAddress());
  provider.on.mockImplementation((_event, listener) => listeners.add(listener));
  provider.off.mockImplementation((_event, listener) => listeners.delete(listener));
  const browser = {};
  vi.stubGlobal("window", browser);
  Object.assign(browser, { self: browser, top: browser });
  listeners.clear();
  install(provider);
  isConnected.mockResolvedValue({ isConnected: true, apiVersion: 1 });
  getNetwork.mockResolvedValue({ network: "TESTNET", networkPassphrase: Networks.TESTNET });
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-15T00:00:00Z"));
  unsignedXdr = transaction().toXDR();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  getAddress.mockResolvedValue({ address });
  signTransaction.mockImplementation(async (unsigned: string) => {
    const tx = TransactionBuilder.fromXDR(unsigned, Networks.TESTNET);
    tx.sign(signer);
    return { signedTxXdr: tx.toXDR(), signerAddress: address };
  });
  module = new LanternModule("testnet");
});
afterEach(() => {
  expect(fetchMock).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function signedResult() {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET);
  tx.sign(signer);
  return { signedTxXdr: tx.toXDR(), signerAddress: address };
}

async function sign() {
  await module.getAddress();
  return module.signTransaction(unsignedXdr, { address, networkPassphrase: Networks.TESTNET });
}

describe("official desktop detection (mock provider, not extension acceptance)", () => {
  it("activates verified desktop v1 with local icon and pinned install link", async () => {
    expect(await module.isAvailable()).toBe(true);
    expect(module.productName).toBe("Lantern");
    expect(module.productIcon).toBe("/wallets/lantern.jpg");
    expect(module.productUrl).toContain("v0.7.0-testnet.21");
  });
  it.each([
    undefined,
    null,
    {},
    { ...provider, apiVersion: "1" },
    { ...provider, isLantern: false },
    { ...provider, on: undefined },
  ])("refuses malformed provider %s", async (value) => {
    install(value);
    expect(await module.isAvailable()).toBe(false);
    await expect(module.getAddress()).rejects.toMatchObject({ code: "LANTERN_UNAVAILABLE" });
    expect(requestAccess).not.toHaveBeenCalled();
  });
  it("refuses embedded frames, disabled websites, and unsupported connected API", async () => {
    Object.assign(window, { top: {} });
    expect(await module.isAvailable()).toBe(false);
    Object.assign(window, { top: window });
    isConnected.mockResolvedValue({ isConnected: false });
    expect(await module.isAvailable()).toBe(false);
    isConnected.mockResolvedValue({ isConnected: true, apiVersion: 2 });
    expect(await module.isAvailable()).toBe(false);
  });
  it("never accesses mainnet provider", async () => {
    const mainnet = new LanternModule("mainnet");
    expect(await mainnet.isAvailable()).toBe(false);
    await expect(mainnet.getAddress()).rejects.toMatchObject({ code: "LANTERN_TESTNET_ONLY" });
    expect(requestAccess).not.toHaveBeenCalled();
  });
});

describe("official connect and sign-only semantics", () => {
  it("connects with an explicit expected testnet and signs the original envelope once", async () => {
    const result = await sign();
    expect(requestAccess).toHaveBeenCalledWith();
    expect(getAddress).toHaveBeenCalledWith();
    expect(getAddress).toHaveBeenCalledTimes(3);
    expect(signTransaction).toHaveBeenCalledOnce();
    expect(signTransaction).toHaveBeenCalledWith(unsignedXdr, {
      address,
      networkPassphrase: Networks.TESTNET,
    });
    expect(result.signerAddress).toBe(address);
    const signed = TransactionBuilder.fromXDR(result.signedTxXdr, Networks.TESTNET);
    expect(signed.hash()).toEqual(TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET).hash());
    expect(signed.signatures).toHaveLength(1);
  });
  it.each([
    {},
    { address: "G-invalid", networkPassphrase: Networks.TESTNET },
    { address: contract, networkPassphrase: Networks.TESTNET },
  ])("rejects malformed or mixed-success identity responses %s", async (response) => {
    getAddress.mockResolvedValue(response);
    await expect(module.getAddress()).rejects.toMatchObject({ code: "LANTERN_INVALID_RESPONSE" });
    expect(signTransaction).not.toHaveBeenCalled();
  });
  it("checks the connected network before any signing request", async () => {
    getNetwork.mockResolvedValue({ network: "PUBLIC", networkPassphrase: Networks.PUBLIC });
    await expect(sign()).rejects.toMatchObject({ code: "LANTERN_WRONG_NETWORK" });
    expect(signTransaction).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    { address },
    { networkPassphrase: Networks.TESTNET },
    { address, networkPassphrase: Networks.PUBLIC },
    { address: other.publicKey(), networkPassphrase: Networks.TESTNET },
  ])(
    "requires the caller's explicit server passphrase and connected account %s",
    async (options) => {
      await module.getAddress();
      await expect(module.signTransaction(unsignedXdr, options)).rejects.toBeInstanceOf(
        LanternWalletError,
      );
      expect(signTransaction).not.toHaveBeenCalled();
    },
  );
  it.each([{ submit: true }, { submitUrl: "https://example.invalid" }, { path: "m/44" }])(
    "refuses unsupported submission or derivation options %s",
    async (options) => {
      await module.getAddress();
      await expect(
        module.signTransaction(unsignedXdr, {
          address,
          networkPassphrase: Networks.TESTNET,
          ...options,
        }),
      ).rejects.toMatchObject({ code: "LANTERN_UNSUPPORTED" });
      expect(signTransaction).not.toHaveBeenCalled();
    },
  );
  it("refuses source-account mismatch before invoking the signer", async () => {
    await module.getAddress();
    await expect(
      module.signTransaction(transaction(other.publicKey()).toXDR(), {
        address,
        networkPassphrase: Networks.TESTNET,
      }),
    ).rejects.toMatchObject({ code: "LANTERN_WRONG_ACCOUNT" });
    expect(signTransaction).not.toHaveBeenCalled();
  });
  it("rechecks the active account immediately before signing", async () => {
    await module.getAddress();
    getAddress.mockResolvedValue({
      address: other.publicKey(),
      networkPassphrase: Networks.TESTNET,
    });
    await expect(
      module.signTransaction(unsignedXdr, { address, networkPassphrase: Networks.TESTNET }),
    ).rejects.toMatchObject({ code: "LANTERN_WRONG_ACCOUNT" });
    expect(signTransaction).not.toHaveBeenCalled();
  });
  it("refuses a replacement provider even if it presents the same account", async () => {
    module = new LanternModule("testnet");
    await module.getAddress();
    const generation = module.connectionGeneration;
    install({ ...provider });
    expect(() => module.assertConnectionGeneration(generation)).toThrow(LanternWalletError);
    await expect(
      module.signTransaction(unsignedXdr, { address, networkPassphrase: Networks.TESTNET }),
    ).rejects.toMatchObject({ code: "LANTERN_WRONG_ACCOUNT" });
    expect(signTransaction).not.toHaveBeenCalled();
  });
  it.each(["body", "signer", "network", "unsigned", "claimed-signer", "old-field"])(
    "refuses an invalid signed result (%s)",
    async (kind) => {
      signTransaction.mockImplementation(async () => {
        const tx =
          kind === "body"
            ? transaction(address, 101n)
            : TransactionBuilder.fromXDR(
                unsignedXdr,
                kind === "network" ? Networks.PUBLIC : Networks.TESTNET,
              );
        if (kind !== "unsigned") tx.sign(kind === "signer" ? other : signer);
        if (kind === "old-field")
          return {
            signedXDR: tx.toXDR(),
            signerAddress: address,
            networkPassphrase: Networks.TESTNET,
          };
        return {
          signedTxXdr: tx.toXDR(),
          signerAddress: kind === "claimed-signer" ? other.publicKey() : address,
          ...(kind !== "missing-network" ? { networkPassphrase: Networks.TESTNET } : {}),
          ...(kind === "mixed-error" ? { error: { code: "internal" } } : {}),
        };
      });
      await expect(sign()).rejects.toBeInstanceOf(LanternWalletError);
    },
  );
  it("preserves existing transaction signatures and refuses dropped signatures", async () => {
    const original = transaction();
    original.sign(other);
    unsignedXdr = original.toXDR();
    const result = await sign();
    expect(
      TransactionBuilder.fromXDR(result.signedTxXdr, Networks.TESTNET).signatures,
    ).toHaveLength(2);
    signTransaction.mockImplementation(async () => {
      const tx = transaction();
      tx.sign(signer);
      return {
        signedTxXdr: tx.toXDR(),
        signerAddress: address,
        networkPassphrase: Networks.TESTNET,
      };
    });
    await expect(sign()).rejects.toMatchObject({ code: "LANTERN_INVALID_RESPONSE" });
  });
  it("disconnects locally and exposes no message/auth-entry signing capability", async () => {
    await module.getAddress();
    await module.disconnect();
    await expect(
      module.signTransaction(unsignedXdr, { address, networkPassphrase: Networks.TESTNET }),
    ).rejects.toMatchObject({ code: "LANTERN_WRONG_ACCOUNT" });
    await expect(module.signAuthEntry()).rejects.toMatchObject({ code: "LANTERN_UNSUPPORTED" });
    await expect(module.signMessage()).rejects.toMatchObject({ code: "LANTERN_UNSUPPORTED" });
  });
});

describe("controlled official provider failures", () => {
  it("maps a signing rejection without submitting or exposing provider payload", async () => {
    signTransaction.mockRejectedValue({
      code: "user_rejected",
      message: "private provider payload",
    });
    await expect(sign()).rejects.toMatchObject({ code: "LANTERN_REJECTED" });
    expect(signTransaction).toHaveBeenCalledOnce();
  });
  it("contains provider error getters that themselves throw", async () => {
    const error = Object.defineProperty({}, "code", {
      get() {
        throw new Error("private payload");
      },
    });
    getAddress.mockRejectedValue(error);
    await expect(module.getAddress()).rejects.toMatchObject({ code: "LANTERN_REQUEST_FAILED" });
  });

  it.each([
    ["user_rejected", "LANTERN_REJECTED", "Transaction cancelled in your wallet."],
    [
      "not_allowed",
      "LANTERN_NOT_ALLOWED",
      "Connect Lantern on TESTNET, or enable websites in Lantern Settings, then reconnect.",
    ],
    [
      "network_mismatch",
      "LANTERN_WRONG_NETWORK",
      "Lantern is on the wrong network. Switch to TESTNET and reconnect before signing.",
    ],
    [
      "account_mismatch",
      "LANTERN_WRONG_ACCOUNT",
      "The Lantern account changed. Reconnect the intended account before signing.",
    ],
  ])("maps the documented semantic code %s", async (code, expected, message) => {
    getAddress.mockRejectedValue({ code, message: "private provider payload" });
    let caught: unknown;
    try {
      await module.getAddress();
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: expected });
    expect(friendlyError(caught)).toEqual({ message });
    expect(JSON.stringify(caught)).not.toContain("private provider payload");
  });
  it.each([
    "user rejected",
    "wallet locked",
    { message: "wrong network; user rejected" },
    { code: "UNKNOWN", message: "private payload" },
  ])("does not infer semantics from arbitrary provider text %s", async (error) => {
    getAddress.mockRejectedValue(error);
    await expect(module.getAddress()).rejects.toMatchObject({ code: "LANTERN_REQUEST_FAILED" });
  });
});

describe("connection lifecycle generations", () => {
  it.each(["account", "network"])("rejects %s drift during signing approval", async (drift) => {
    const response = deferred<ReturnType<typeof signedResult>>();
    signTransaction.mockReturnValue(response.promise);
    await module.getAddress();
    const pending = module.signTransaction(unsignedXdr, {
      address,
      networkPassphrase: Networks.TESTNET,
    });
    await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledOnce());
    getAddress.mockResolvedValue({
      address: drift === "account" ? other.publicKey() : address,
      networkPassphrase: Networks.TESTNET,
    });
    if (drift === "network")
      getNetwork.mockResolvedValue({ network: "PUBLIC", networkPassphrase: Networks.PUBLIC });
    response.resolve(signedResult());
    await expect(pending).rejects.toMatchObject({
      code: drift === "account" ? "LANTERN_WRONG_ACCOUNT" : "LANTERN_WRONG_NETWORK",
    });
  });
  it("does not return a signature after disconnect during approval", async () => {
    const response = deferred<ReturnType<typeof signedResult>>();
    signTransaction.mockReturnValue(response.promise);
    await module.getAddress();
    const pending = module.signTransaction(unsignedXdr, {
      address,
      networkPassphrase: Networks.TESTNET,
    });
    await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledOnce());
    await module.disconnect();
    response.resolve(signedResult());
    await expect(pending).rejects.toMatchObject({ code: "LANTERN_WRONG_ACCOUNT" });
  });
  it("cannot resurrect a connection after disconnect during getAddress", async () => {
    const response = deferred<{ address: string; networkPassphrase: string }>();
    getAddress.mockReturnValueOnce(response.promise);
    const pending = module.getAddress();
    await module.disconnect();
    response.resolve({ address, networkPassphrase: Networks.TESTNET });
    await expect(pending).rejects.toMatchObject({ code: "LANTERN_WRONG_ACCOUNT" });
    await expect(
      module.signTransaction(unsignedXdr, { address, networkPassphrase: Networks.TESTNET }),
    ).rejects.toMatchObject({ code: "LANTERN_WRONG_ACCOUNT" });
    expect(signTransaction).not.toHaveBeenCalled();
  });
  it.each(["resolve", "reject"])(
    "an older connect that later %ss cannot clear a newer connection",
    async (outcome) => {
      const response = deferred<{ address: string; networkPassphrase: string }>();
      getAddress.mockReturnValueOnce(response.promise);
      const older = module.getAddress();
      const olderOutcome = older.catch((error) => error);
      await vi.waitFor(() => expect(getAddress).toHaveBeenCalledOnce());
      await module.getAddress();
      if (outcome === "resolve")
        response.resolve({ address: other.publicKey(), networkPassphrase: Networks.TESTNET });
      else response.reject({ code: "internal" });
      expect(await olderOutcome).toBeInstanceOf(LanternWalletError);
      const signed = await module.signTransaction(unsignedXdr, {
        address,
        networkPassphrase: Networks.TESTNET,
      });
      expect(signed.signerAddress).toBe(address);
    },
  );
  it("a stale signing rejection cannot clear a reconnected generation", async () => {
    const response = deferred<ReturnType<typeof signedResult>>();
    signTransaction.mockReturnValueOnce(response.promise);
    await module.getAddress();
    const pending = module.signTransaction(unsignedXdr, {
      address,
      networkPassphrase: Networks.TESTNET,
    });
    const outcome = pending.catch((error) => error);
    await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledOnce());
    await module.getAddress();
    response.reject({ code: "user_rejected" });
    expect(await outcome).toBeInstanceOf(LanternWalletError);
    await expect(
      module.signTransaction(unsignedXdr, { address, networkPassphrase: Networks.TESTNET }),
    ).resolves.toMatchObject({ signerAddress: address });
  });
});

describe("synchronous lifecycle invalidation and recovery (mock only)", () => {
  it.each(["account", "network", "revoke"])(
    "cannot revive a signature after %s changes away and back",
    async (reason) => {
      const response = deferred<ReturnType<typeof signedResult>>();
      signTransaction.mockReturnValueOnce(response.promise);
      await module.getAddress();
      const pending = module.signTransaction(unsignedXdr, {
        address,
        networkPassphrase: Networks.TESTNET,
      });
      const outcome = pending.catch((error) => error);
      await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledOnce());
      change(reason);
      change(reason);
      response.resolve(signedResult());
      expect(await outcome).toMatchObject({ code: "LANTERN_WRONG_ACCOUNT" });
      await expect(module.getAddress({ skipRequestAccess: true })).rejects.toMatchObject({
        code: "LANTERN_WRONG_ACCOUNT",
      });
      await module.getAddress();
      expect(requestAccess).toHaveBeenCalledTimes(2);
    },
  );

  it("detaches listeners on disconnect and provider replacement", async () => {
    await module.getAddress();
    expect(listeners.size).toBe(1);
    await module.getAddress();
    expect(listeners.size).toBe(1);
    await module.disconnect();
    expect(listeners.size).toBe(0);
    await module.getAddress();
    install({ ...provider });
    await expect(module.getAddress({ skipRequestAccess: true })).rejects.toBeInstanceOf(
      LanternWalletError,
    );
    expect(provider.off).toHaveBeenCalledTimes(2);
    expect(listeners.size).toBe(0);
  });

  it.each(["timeout", "connection_lost", "account_mismatch", "user_rejected"])(
    "retains exact prepared recovery hash except explicit %s refusal",
    async (code) => {
      const { signWithRecovery } = await import("@/lib/wallet-signing-recovery");
      await module.getAddress();
      signTransaction.mockRejectedValue({ code, message: "private provider payload" });
      let record: import("@/lib/wallet-signing-recovery").SigningAttempt | null = null;
      const submit = vi.fn();
      const task = signWithRecovery({
        network: "testnet",
        xdr: unsignedXdr,
        address,
        networkPassphrase: Networks.TESTNET,
        check: () => {},
        save: (value) => {
          record = value;
        },
        read: () => record,
        clearRejected: () => {
          record = null;
        },
        sign: () =>
          module.signTransaction(unsignedXdr, { address, networkPassphrase: Networks.TESTNET }),
      }).then(submit);
      await expect(task).rejects.toBeInstanceOf(LanternWalletError);
      expect(submit).not.toHaveBeenCalled();
      if (code === "user_rejected") expect(record).toBeNull();
      else
        expect(record).toMatchObject({
          phase: "signing",
          txHash: transaction().hash().toString("hex"),
        });
    },
  );

  it("a lifecycle event before a late refusal retains the signing HOLD", async () => {
    const { signWithRecovery } = await import("@/lib/wallet-signing-recovery");
    const response = deferred<ReturnType<typeof signedResult>>();
    await module.getAddress();
    signTransaction.mockReturnValueOnce(response.promise);
    let record: import("@/lib/wallet-signing-recovery").SigningAttempt | null = null;
    const task = signWithRecovery({
      network: "testnet",
      xdr: unsignedXdr,
      address,
      networkPassphrase: Networks.TESTNET,
      check: () => {},
      save: (value) => {
        record = value;
      },
      read: () => record,
      clearRejected: () => {
        record = null;
      },
      sign: () =>
        module.signTransaction(unsignedXdr, { address, networkPassphrase: Networks.TESTNET }),
    });
    const outcome = task.catch((error) => error);
    await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledOnce());
    change("revoke");
    response.reject({ code: "user_rejected" });
    expect(await outcome).toMatchObject({ code: "LANTERN_CONNECTION_LOST" });
    expect(record).toMatchObject({ phase: "signing" });
  });

  it.each([
    "network_mismatch",
    "invalid_request",
    "unsupported",
    "busy",
    "timeout",
    "connection_lost",
    "internal",
  ])("contains %s errors without leaking provider payload", async (code) => {
    signTransaction.mockRejectedValue({ code, message: "private provider payload" });
    let error: unknown;
    try {
      await sign();
    } catch (value) {
      error = value;
    }
    expect(error).toBeInstanceOf(LanternWalletError);
    expect(friendlyError(error).message).not.toContain("private provider payload");
    expect(friendlyError(error).message).not.toBe("Transaction cancelled in your wallet.");
  });
});

describe("non-interactive connection reads", () => {
  it("reads address and network without requesting another grant", async () => {
    await module.getAddress();
    const generation = module.connectionGeneration;
    await module.getAddress({ skipRequestAccess: true });
    await module.getNetwork();
    expect(requestAccess).toHaveBeenCalledOnce();
    expect(module.connectionGeneration).toBe(generation);
  });
});
