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
import { PROVISIONAL_LANTERN_API } from "@/lib/stellar/lantern-provider";
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
const provider = { apiVersion: PROVISIONAL_LANTERN_API, getAddress, signTransaction };
let module: LanternModule;
let unsignedXdr: string;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", {});
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-15T00:00:00Z"));
  unsignedXdr = transaction().toXDR();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  getAddress.mockResolvedValue({ address, networkPassphrase: Networks.TESTNET });
  signTransaction.mockImplementation(async (unsigned: string) => {
    const tx = TransactionBuilder.fromXDR(unsigned, Networks.TESTNET);
    tx.sign(signer);
    return { signedTxXdr: tx.toXDR(), signerAddress: address, networkPassphrase: Networks.TESTNET };
  });
  module = new LanternModule("testnet", () => provider);
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
  return { signedTxXdr: tx.toXDR(), signerAddress: address, networkPassphrase: Networks.TESTNET };
}

async function sign() {
  await module.getAddress();
  return module.signTransaction(unsignedXdr, { address, networkPassphrase: Networks.TESTNET });
}

describe("experimental Lantern adapter activation", () => {
  it("keeps the real browser row unavailable without inspecting unverified window.lantern", async () => {
    const read = vi.fn(() => provider);
    Object.defineProperty(window, "lantern", { configurable: true, get: read });
    const browserModule = new LanternModule("testnet");
    expect(await browserModule.isAvailable()).toBe(false);
    expect(browserModule.productName).toContain("not yet supported");
    expect(browserModule.productUrl).toBe("https://golantern.xyz");
    expect(browserModule.productIcon).toBe("/wallets/lantern.jpg");
    await expect(browserModule.getAddress()).rejects.toMatchObject({ code: "LANTERN_UNVERIFIED" });
    await expect(
      browserModule.signTransaction(unsignedXdr, { address, networkPassphrase: Networks.TESTNET }),
    ).rejects.toMatchObject({ code: "LANTERN_UNVERIFIED" });
    expect(read).not.toHaveBeenCalled();
    expect(getAddress).not.toHaveBeenCalled();
    expect(signTransaction).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    null,
    {},
    { apiVersion: "1", getAddress, signTransaction },
    { apiVersion: PROVISIONAL_LANTERN_API, getAddress },
  ])("refuses missing or unrecognized provisional provider %s", async (value) => {
    const unavailable = new LanternModule("testnet", () => value);
    expect(await unavailable.isAvailable()).toBe(false);
    await expect(unavailable.getAddress()).rejects.toMatchObject({ code: "LANTERN_UNAVAILABLE" });
    expect(getAddress).not.toHaveBeenCalled();
  });
  it("contains provider lookup failures so unavailable wallets do not break the picker", async () => {
    const unavailable = new LanternModule("testnet", () => {
      throw new Error("private lookup failure");
    });
    expect(await unavailable.isAvailable()).toBe(false);
    await expect(unavailable.getAddress()).rejects.toMatchObject({
      code: "LANTERN_REQUEST_FAILED",
    });
  });
  it("supports only explicitly injected provisional testnet fixtures; mainnet fails before reading a provider", async () => {
    expect(await module.isAvailable()).toBe(true);
    expect(await module.isPlatformWrapper()).toBe(false);
    const read = vi.fn(() => provider);
    const mainnet = new LanternModule("mainnet", read);
    expect(await mainnet.isAvailable()).toBe(false);
    await expect(mainnet.getAddress()).rejects.toMatchObject({ code: "LANTERN_TESTNET_ONLY" });
    await expect(
      mainnet.signTransaction(unsignedXdr, { address, networkPassphrase: Networks.PUBLIC }),
    ).rejects.toMatchObject({ code: "LANTERN_TESTNET_ONLY" });
    expect(read).not.toHaveBeenCalled();
  });
});

describe("provisional connect and sign-only semantics", () => {
  it("connects with an explicit expected testnet and signs the original envelope once", async () => {
    const result = await sign();
    expect(getAddress).toHaveBeenCalledWith({ networkPassphrase: Networks.TESTNET });
    expect(getAddress).toHaveBeenCalledTimes(3);
    expect(signTransaction).toHaveBeenCalledOnce();
    expect(signTransaction).toHaveBeenCalledWith(unsignedXdr, {
      address,
      networkPassphrase: Networks.TESTNET,
      submit: false,
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
    { address },
    { address, networkPassphrase: Networks.TESTNET, error: { code: "LOCKED" } },
  ])("rejects malformed or mixed-success identity responses %s", async (response) => {
    getAddress.mockResolvedValue(response);
    await expect(module.getAddress()).rejects.toMatchObject({ code: "LANTERN_INVALID_RESPONSE" });
    expect(signTransaction).not.toHaveBeenCalled();
  });
  it("checks the connected network before any signing request", async () => {
    getAddress.mockResolvedValue({ address, networkPassphrase: Networks.PUBLIC });
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
    let current = provider;
    module = new LanternModule("testnet", () => current);
    await module.getAddress();
    current = { ...provider };
    await expect(
      module.signTransaction(unsignedXdr, { address, networkPassphrase: Networks.TESTNET }),
    ).rejects.toMatchObject({ code: "LANTERN_WRONG_ACCOUNT" });
    expect(signTransaction).not.toHaveBeenCalled();
  });
  it.each([
    "body",
    "signer",
    "network",
    "unsigned",
    "claimed-signer",
    "old-field",
    "missing-network",
    "mixed-error",
  ])("refuses an invalid signed result (%s)", async (kind) => {
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
        ...(kind === "mixed-error" ? { error: { code: "LOCKED" } } : {}),
      };
    });
    await expect(sign()).rejects.toBeInstanceOf(LanternWalletError);
  });
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

describe("controlled provisional provider failures", () => {
  it("maps a signing rejection without submitting or exposing provider payload", async () => {
    signTransaction.mockRejectedValue({
      code: "USER_REJECTED",
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
    ["USER_REJECTED", "LANTERN_REJECTED", "Transaction cancelled in your wallet."],
    ["LOCKED", "LANTERN_LOCKED", "Unlock Lantern and try again."],
    [
      "WRONG_NETWORK",
      "LANTERN_WRONG_NETWORK",
      "Lantern is on the wrong network. Switch to TESTNET and reconnect before signing.",
    ],
    [
      "WRONG_ACCOUNT",
      "LANTERN_WRONG_ACCOUNT",
      "The Lantern account changed. Reconnect the intended account before signing.",
    ],
  ])("maps only the declared fixture code %s", async (code, expected, message) => {
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

describe("provisional connection lifecycle generations", () => {
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
      networkPassphrase: drift === "network" ? Networks.PUBLIC : Networks.TESTNET,
    });
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
      await module.getAddress();
      if (outcome === "resolve")
        response.resolve({ address: other.publicKey(), networkPassphrase: Networks.TESTNET });
      else response.reject({ code: "LOCKED" });
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
    response.reject({ code: "USER_REJECTED" });
    expect(await outcome).toBeInstanceOf(LanternWalletError);
    await expect(
      module.signTransaction(unsignedXdr, { address, networkPassphrase: Networks.TESTNET }),
    ).resolves.toMatchObject({ signerAddress: address });
  });
});
