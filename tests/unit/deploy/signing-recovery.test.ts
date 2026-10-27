import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  signWithRecovery,
  isExplicitSigningRejection,
  isSigningAttempt,
  readSigningRecovery,
  type SigningAttempt,
  type SigningRecovery,
} from "@/lib/wallet-signing-recovery";
import { LanternWalletError } from "@/lib/stellar/lantern-wallet-error";
import { preparedWalletTransactionHash } from "@/lib/stellar/wallet-signature";

// In-memory sign-only wallet mock; no network, persisted envelopes or real-wallet acceptance.
function fixture() {
  const wallet = Keypair.random();
  const other = Keypair.random();
  const tx = new TransactionBuilder(new Account(wallet.publicKey(), "10"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({ destination: other.publicKey(), amount: "0.1", asset: Asset.native() }),
    )
    .setTimeout(180)
    .build();
  const hash = tx.hash().toString("hex");
  const xdr = tx.toXDR();
  tx.sign(wallet);
  let stored: ({ txHash: string } & SigningRecovery) | null = null;
  const clear = vi.fn((attempt: SigningAttempt) => {
    if (isSigningAttempt(stored, attempt)) stored = null;
  });
  const options = {
    network: "testnet" as const,
    xdr,
    address: wallet.publicKey(),
    networkPassphrase: Networks.TESTNET,
    check: vi.fn(),
    save: vi.fn((attempt: SigningAttempt) => {
      stored = { ...attempt };
    }),
    read: () => stored,
    clearRejected: clear,
    sign: vi.fn(async () => ({ signedTxXdr: tx.toXDR() })),
  };
  return {
    wallet,
    other,
    tx,
    hash,
    options,
    stored: () => stored,
    replace: (value: typeof stored) => {
      stored = value;
    },
  };
}

describe("public identity before a sign-only wallet request", () => {
  it("persists the source/network-bound prepared hash before opening the wallet, then verifies the unchanged signed response", async () => {
    const f = fixture();
    f.options.sign.mockImplementation(async () => {
      expect(f.stored()).toEqual({
        txHash: f.hash,
        phase: "signing",
        attemptId: expect.any(String),
      });
      expect(Object.keys(f.stored()!).sort()).toEqual(["attemptId", "phase", "txHash"]);
      return { signedTxXdr: f.tx.toXDR() };
    });
    const signed = await signWithRecovery(f.options);
    expect(signed.attempt.txHash).toBe(f.hash);
    expect(f.options.save).toHaveBeenCalledOnce();
    expect(f.options.sign).toHaveBeenCalledOnce();
    // Returning a signature does not itself mean the app submitted it.
    expect(f.stored()?.phase).toBe("signing");
  });
  it.each(["write", "readback"])(
    "fails closed before wallet access on storage %s failure",
    async (mode) => {
      const f = fixture();
      if (mode === "write")
        f.options.save.mockImplementation(() => {
          throw new Error("Storage blocked");
        });
      else f.options.save.mockImplementation(() => {});
      await expect(signWithRecovery(f.options)).rejects.toThrow();
      expect(f.options.sign).not.toHaveBeenCalled();
    },
  );
  it.each(["network", "source"])(
    "rejects the prepared %s before persisting or signing",
    async (mode) => {
      const f = fixture();
      if (mode === "network") f.options.networkPassphrase = Networks.PUBLIC;
      else f.options.address = f.other.publicKey();
      await expect(signWithRecovery(f.options)).rejects.toThrow();
      expect(f.options.save).not.toHaveBeenCalled();
      expect(f.options.sign).not.toHaveBeenCalled();
    },
  );
  it("does not reinterpret an unsigned response as a valid wallet signature", async () => {
    const f = fixture();
    f.options.sign.mockResolvedValue({ signedTxXdr: f.options.xdr });
    await expect(signWithRecovery(f.options)).rejects.toThrow(/did not sign/);
    expect(f.stored()).toMatchObject({ txHash: f.hash, phase: "signing" });
  });
  it("retains the original hash when the wallet changes the transaction body", async () => {
    const f = fixture();
    const changed = new TransactionBuilder(new Account(f.wallet.publicKey(), "11"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: f.other.publicKey(),
          amount: "0.2",
          asset: Asset.native(),
        }),
      )
      .setTimeout(180)
      .build();
    changed.sign(f.wallet);
    f.options.sign.mockResolvedValue({ signedTxXdr: changed.toXDR() });
    await expect(signWithRecovery(f.options)).rejects.toThrow(/changed/);
    expect(f.stored()?.txHash).toBe(f.hash);
    expect(f.options.clearRejected).not.toHaveBeenCalled();
  });
  it.each([
    { code: -4, ext: "user_rejected" },
    { code: 4001 },
    new LanternWalletError("LANTERN_REJECTED"),
  ])("releases only its signing reservation on explicit refusal %j", async (error) => {
    const f = fixture();
    f.options.sign.mockRejectedValue(error);
    await expect(signWithRecovery(f.options)).rejects.toBe(error);
    expect(f.stored()).toBeNull();
    expect(f.options.clearRejected).toHaveBeenCalledOnce();
  });
  it.each([
    { code: -1, ext: "timeout" },
    { code: -4, ext: "connection_lost" },
    { code: "timeout" },
    new Error("User rejected? Maybe connection lost"),
  ])("preserves an unknown signing outcome %j", async (error) => {
    const f = fixture();
    f.options.sign.mockRejectedValue(error);
    await expect(signWithRecovery(f.options)).rejects.toBe(error);
    expect(f.stored()).toMatchObject({ txHash: f.hash, phase: "signing" });
    expect(f.options.clearRejected).not.toHaveBeenCalled();
  });
  it.each(["new-attempt", "submitted", "legacy"])(
    "a stale refusal cannot release a %s record with the same hash",
    async (mode) => {
      const f = fixture();
      f.options.sign.mockImplementation(async () => {
        f.replace(
          mode === "legacy"
            ? { txHash: f.hash }
            : {
                txHash: f.hash,
                phase: mode === "submitted" ? "submitted" : "signing",
                attemptId: mode === "submitted" ? f.stored()!.attemptId : crypto.randomUUID(),
              },
        );
        throw { code: -4, ext: "user_rejected" };
      });
      await expect(signWithRecovery(f.options)).rejects.toMatchObject({ code: -4 });
      expect(f.stored()).not.toBeNull();
      expect(f.options.clearRejected).not.toHaveBeenCalled();
    },
  );
  it.each(["abort", "marker-replaced", "marker-cleared"])(
    "rejects late completion after %s without releasing recovery",
    async (mode) => {
      const f = fixture();
      const controller = new AbortController();
      f.options.check.mockImplementation(() => controller.signal.throwIfAborted());
      f.options.sign.mockImplementation(async () => {
        if (mode === "abort") controller.abort();
        if (mode === "marker-cleared") f.replace(null);
        if (mode === "marker-replaced")
          f.replace({ txHash: f.hash, phase: "signing", attemptId: crypto.randomUUID() });
        return { signedTxXdr: f.tx.toXDR() };
      });
      await expect(signWithRecovery(f.options)).rejects.toThrow();
      expect(f.options.clearRejected).not.toHaveBeenCalled();
      if (mode === "abort") expect(f.stored()).toMatchObject({ txHash: f.hash, phase: "signing" });
    },
  );
  it("a late explicit refusal after navigation cannot clear recovery outside the released lock", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.options.check.mockImplementation(() => controller.signal.throwIfAborted());
    f.options.sign.mockImplementation(async () => {
      controller.abort();
      throw { code: -4, ext: "user_rejected" };
    });
    await expect(signWithRecovery(f.options)).rejects.toThrow();
    expect(f.stored()).toMatchObject({ txHash: f.hash, phase: "signing" });
    expect(f.options.clearRejected).not.toHaveBeenCalled();
  });
  it("computes the same public hash independently of envelope signatures", () => {
    const f = fixture();
    expect(
      preparedWalletTransactionHash(
        "testnet",
        f.options.xdr,
        f.wallet.publicKey(),
        Networks.TESTNET,
      ),
    ).toBe(f.hash);
  });
});

describe("recovery metadata compatibility", () => {
  it("leaves legacy submitted records unchanged and ignores extra private fields", () => {
    expect(readSigningRecovery({ txHash: "a".repeat(64), signedXdr: "never copy" })).toEqual({});
    expect(
      isSigningAttempt(
        { txHash: "a".repeat(64) },
        { txHash: "a".repeat(64), phase: "signing", attemptId: crypto.randomUUID() },
      ),
    ).toBe(false);
  });
  it.each([
    { phase: "signing" },
    { attemptId: crypto.randomUUID() },
    { phase: "other", attemptId: crypto.randomUUID() },
    { phase: "signing", attemptId: "invalid" },
  ])("fails closed for malformed metadata %j", (value) => {
    expect(() => readSigningRecovery(value)).toThrow(/invalid/);
  });
  it("never infers definitive cancellation from error wording alone", () => {
    expect(isExplicitSigningRejection(new Error("User declined access"))).toBe(false);
    expect(
      isExplicitSigningRejection({
        code: -1,
        ext: "timeout",
        message: "User rejected the request",
      }),
    ).toBe(false);
  });
});
