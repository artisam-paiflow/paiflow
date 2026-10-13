import { Account, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LanternWallet,
  LANTERN_SIGNING_UNSUPPORTED,
  trustedLanternOrigin,
  selectLanternWallet,
} from "../../../components/deploy/lantern-wallet";

const ORIGIN = "https://android.golantern.xyz";
const signer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
const other = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 8));
const sponsor = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9));
const address = signer.publicKey();
const xdr = new TransactionBuilder(new Account(address, "1"), {
  fee: "100",
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(Operation.manageData({ name: "test", value: "original" }))
  .setTimeout(180)
  .build();
xdr.sign(sponsor);
const original = xdr.toXDR();
function signed(envelope = original, key = signer) {
  const tx = TransactionBuilder.fromXDR(envelope, Networks.TESTNET);
  tx.sign(key);
  return tx.toXDR();
}

function frame(origin = ORIGIN) {
  const listeners = new Set<(event: MessageEvent<unknown>) => void>();
  const parent = {
    postMessage: vi.fn<(message: Record<string, unknown>, target: string) => void>(),
  };
  const win = {
    parent,
    location: { ancestorOrigins: [origin] },
    document: { referrer: `${origin}/apps` },
    addEventListener: vi.fn((_type: string, listener: (event: MessageEvent<unknown>) => void) =>
      listeners.add(listener),
    ),
    removeEventListener: vi.fn((_type: string, listener: (event: MessageEvent<unknown>) => void) =>
      listeners.delete(listener),
    ),
  };
  const reply = (data: unknown, from = origin, source: unknown = parent) => {
    for (const listener of listeners)
      listener({ data, origin: from, source } as MessageEvent<unknown>);
  };
  const respondIdentity = (publicKey = address, network = "TESTNET") => {
    reply({ type: "lantern:connecting" });
    reply({ type: "lantern:publicKey", publicKey, network });
  };
  const auto = () =>
    parent.postMessage.mockImplementation((message) => {
      if (message.type === "lantern:getPublicKey") respondIdentity();
      else {
        reply({ type: "lantern:signing", id: message.id });
        reply({
          type: "lantern:xdrSigned",
          id: message.id,
          signedXdr: signed(message.xdr as string),
        });
      }
    });
  return {
    win: win as unknown as Window,
    raw: win,
    parent,
    listeners,
    reply,
    respondIdentity,
    auto,
  };
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
const opts = { networkPassphrase: Networks.TESTNET };
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Lantern parent selection", () => {
  it("selects only the immediate approved parent and never standalone tabs", () => {
    for (const origin of [ORIGIN, "chrome-extension://iflpkjgolcbleombhldiibhojohjpnmd"]) {
      expect(trustedLanternOrigin(frame(origin).win)).toBe(origin);
    }
    for (const origin of [
      "https://localhost",
      "https://app.golantern.xyz",
      `${ORIGIN}.evil.test`,
      "null",
      "chrome-extension://other",
    ]) {
      expect(trustedLanternOrigin(frame(origin).win)).toBeNull();
    }
    const f = frame();
    Object.assign(f.raw, { parent: f.win });
    expect(trustedLanternOrigin(f.win)).toBeNull();
    expect(trustedLanternOrigin(undefined)).toBeNull();
    expect(selectLanternWallet("testnet")).toBeNull();
  });
  it("falls back to the referrer but refuses an untrusted immediate ancestor", () => {
    const f = frame();
    f.raw.location.ancestorOrigins = [];
    expect(trustedLanternOrigin(f.win)).toBe(ORIGIN);
    f.raw.location.ancestorOrigins = ["https://evil.test", ORIGIN];
    expect(trustedLanternOrigin(f.win)).toBeNull();
    f.raw.location.ancestorOrigins = [];
    f.raw.document.referrer = "";
    expect(trustedLanternOrigin(f.win)).toBeNull();
  });
});

describe("Lantern bridge security and signing", () => {
  it("returns the existing signedTxXdr interface without modifying the body or dropping sponsor signatures", async () => {
    const f = frame();
    f.auto();
    const wallet = new LanternWallet("testnet", f.win);
    expect(await wallet.getAddress()).toEqual({ address });
    expect(await wallet.signTransaction(original, opts)).toEqual({ signedTxXdr: signed() });
    expect(f.parent.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
      "lantern:getPublicKey",
      "lantern:getPublicKey",
      "lantern:signXdr",
      "lantern:getPublicKey",
    ]);
    const signing = f.parent.postMessage.mock.calls[2]![0];
    expect(signing.xdr).toBe(original);
    expect(typeof signing.id).toBe("string");
    for (const [, target] of f.parent.postMessage.mock.calls) expect(target).toBe(ORIGIN);
    expect(f.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects forged source/origin, malformed identities and unknown network names", async () => {
    const f = frame();
    const wallet = new LanternWallet("testnet", f.win);
    const pending = wallet.getAddress();
    await flush();
    for (const [from, source] of [
      [`${ORIGIN}.evil.test`, f.parent],
      [ORIGIN, {}],
    ] as const) {
      f.reply({ type: "lantern:publicKey", publicKey: address, network: "TESTNET" }, from, source);
    }
    for (const data of [
      null,
      [],
      { type: "lantern:publicKey", publicKey: "GNOTVALID", network: "TESTNET" },
      { type: "lantern:publicKey", publicKey: address, network: "testnet" },
    ])
      f.reply(data);
    expect(f.listeners.size).toBe(1);
    f.respondIdentity();
    expect(await pending).toEqual({ address });
    expect(f.listeners.size).toBe(0);
  });
  it("requires deployment/passphrase agreement and connection before signing", async () => {
    const f = frame();
    f.auto();
    const wallet = new LanternWallet("testnet", f.win);
    await expect(wallet.signTransaction(original, opts)).rejects.toThrow("Connect");
    await wallet.getAddress();
    await expect(
      wallet.signTransaction(original, { networkPassphrase: Networks.PUBLIC }),
    ).rejects.toThrow("deployment network");
    await expect(
      wallet.signTransaction(original, { ...opts, address: other.publicKey() }),
    ).rejects.toThrow("account");
    expect(f.parent.postMessage.mock.calls).toHaveLength(1);
  });
  it("checks TESTNET/PUBLIC against the requested deployment", async () => {
    const f = frame();
    f.parent.postMessage.mockImplementation(() => f.respondIdentity(address, "PUBLIC"));
    await expect(new LanternWallet("testnet", f.win).getAddress()).rejects.toThrow("Testnet");
    expect(await new LanternWallet("mainnet", f.win).getAddress()).toEqual({ address });
  });
  it("requires explicit reconnect when pre-sign account or network changes", async () => {
    for (const [publicKey, network] of [
      [other.publicKey(), "TESTNET"],
      [address, "PUBLIC"],
    ]) {
      const f = frame();
      f.auto();
      const wallet = new LanternWallet("testnet", f.win);
      await wallet.getAddress();
      f.parent.postMessage.mockImplementation(() => f.respondIdentity(publicKey, network));
      await expect(wallet.signTransaction(original, opts)).rejects.toThrow(/reconnect|Reconnect/);
      expect(
        f.parent.postMessage.mock.calls.every(([message]) => message.type !== "lantern:signXdr"),
      ).toBe(true);
      await expect(wallet.signTransaction(original, opts)).rejects.toThrow("Connect");
    }
  });
  it("does not return a signature if account changes during review", async () => {
    const f = frame();
    f.auto();
    const wallet = new LanternWallet("testnet", f.win);
    await wallet.getAddress();
    let completed = false;
    f.parent.postMessage.mockImplementation((message) => {
      if (message.type === "lantern:getPublicKey")
        f.respondIdentity(completed ? other.publicKey() : address);
      else {
        f.reply({ type: "lantern:signing", id: message.id });
        completed = true;
        f.reply({ type: "lantern:xdrSigned", id: message.id, signedXdr: signed() });
      }
    });
    await expect(wallet.signTransaction(original, opts)).rejects.toThrow(
      "account or network changed",
    );
  });
  it("requires matching signing IDs and a signing acknowledgment", async () => {
    const f = frame();
    f.auto();
    const wallet = new LanternWallet("testnet", f.win);
    await wallet.getAddress();
    f.parent.postMessage.mockImplementation((message) => {
      if (message.type === "lantern:getPublicKey") f.respondIdentity();
    });
    const pending = wallet.signTransaction(original, opts);
    await flush();
    const id = f.parent.postMessage.mock.calls.at(-1)![0].id;
    for (const invalidId of [undefined, "different", 3]) {
      f.reply({ type: "lantern:signing", id: invalidId });
      f.reply({ type: "lantern:xdrSigned", id: invalidId, signedXdr: signed() });
    }
    f.reply({ type: "lantern:xdrSigned", id, signedXdr: signed() });
    expect(f.listeners.size).toBe(1);
    f.reply({ type: "lantern:signing", id });
    f.reply({ type: "lantern:xdrSigned", id, signedXdr: 4 });
    expect(f.listeners.size).toBe(1);
    f.auto();
    f.reply({ type: "lantern:xdrSigned", id, signedXdr: signed() });
    await expect(pending).resolves.toEqual({ signedTxXdr: signed() });
  });
  it.each([
    { type: "lantern:signRejected" },
    { type: "lantern:signRejected", error: "Wallet is locked." },
    { type: "lantern:txError", error: "Connect the wallet first." },
    { type: "lantern:txError", error: "Another request is waiting for review." },
  ])("handles wallet rejection/error %j and clears connection", async (error) => {
    const f = frame();
    f.auto();
    const wallet = new LanternWallet("testnet", f.win);
    await wallet.getAddress();
    f.parent.postMessage.mockImplementation((message) => {
      if (message.type === "lantern:getPublicKey") f.respondIdentity();
      else f.reply({ ...error, id: message.id });
    });
    await expect(wallet.signTransaction(original, opts)).rejects.toThrow(error.error ?? "rejected");
    await expect(wallet.signTransaction(original, opts)).rejects.toThrow("Connect");
    expect(f.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["malformed", "changed body", "missing sponsor", "wrong signer"])(
    "refuses %s signed envelopes",
    async (kind) => {
      const f = frame();
      f.auto();
      const wallet = new LanternWallet("testnet", f.win);
      await wallet.getAddress();
      let bad = "not xdr";
      if (kind === "changed body")
        bad = signed(
          new TransactionBuilder(new Account(address, "2"), {
            fee: "100",
            networkPassphrase: Networks.TESTNET,
          })
            .addOperation(Operation.manageData({ name: "different", value: "body" }))
            .setTimeout(180)
            .build()
            .toXDR(),
        );
      if (kind === "missing sponsor") {
        const tx = TransactionBuilder.fromXDR(original, Networks.TESTNET);
        tx.signatures.splice(0);
        tx.sign(signer);
        bad = tx.toXDR();
      }
      if (kind === "wrong signer") bad = signed(original, other);
      f.parent.postMessage.mockImplementation((message) => {
        if (message.type === "lantern:getPublicKey") f.respondIdentity();
        else {
          f.reply({ type: "lantern:signing", id: message.id });
          f.reply({ type: "lantern:xdrSigned", id: message.id, signedXdr: bad });
        }
      });
      await expect(wallet.signTransaction(original, opts)).rejects.toThrow(
        "invalid signed transaction",
      );
    },
  );
});

describe("Lantern serialization and lifecycle", () => {
  it("settles queued cancellation while another connection remains pending", async () => {
    const f = frame();
    const a = new LanternWallet("testnet", f.win);
    const b = new LanternWallet("testnet", f.win);
    const controller = new AbortController();
    const first = a.getAddress();
    const pending = b.getAddress({ signal: controller.signal });
    await flush();
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(f.parent.postMessage).toHaveBeenCalledTimes(1);
    expect(f.listeners.size).toBe(1);
    f.respondIdentity();
    await first;
  });
  it("disconnect invalidates a connection reply before its continuation runs", async () => {
    const f = frame();
    const wallet = new LanternWallet("testnet", f.win);
    f.parent.postMessage.mockImplementation(() => {
      f.respondIdentity();
      wallet.disconnect();
    });
    await expect(wallet.getAddress()).rejects.toThrow("cancelled");
    await expect(wallet.signTransaction(original, opts)).rejects.toThrow("Connect");
    expect(f.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("never sends an already aborted connection", async () => {
    const f = frame();
    const controller = new AbortController();
    controller.abort();
    await expect(
      new LanternWallet("testnet", f.win).getAddress({ signal: controller.signal }),
    ).rejects.toThrow("cancelled");
    expect(f.parent.postMessage).not.toHaveBeenCalled();
    expect(f.listeners.size).toBe(0);
  });
  it("ignores ID-less signing errors during connection", async () => {
    const f = frame();
    const pending = new LanternWallet("testnet", f.win).getAddress();
    await flush();
    f.reply({ type: "lantern:txError", error: "stale signing error" });
    f.reply({ type: "lantern:signRejected" });
    expect(f.listeners.size).toBe(1);
    f.respondIdentity();
    await expect(pending).resolves.toEqual({ address });
  });
  it("cleans up listeners if posting fails", async () => {
    const f = frame();
    f.parent.postMessage.mockImplementation(() => {
      throw new Error("unavailable");
    });
    await expect(new LanternWallet("testnet", f.win).getAddress()).rejects.toThrow(
      "Could not contact Lantern",
    );
    expect(f.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("serializes all bridge workflows across distinct adapters and networks", async () => {
    const f = frame();
    const a = new LanternWallet("testnet", f.win);
    const b = new LanternWallet("mainnet", f.win);
    const first = a.getAddress();
    const second = b.getAddress();
    await flush();
    expect(f.parent.postMessage).toHaveBeenCalledTimes(1);
    f.respondIdentity();
    await first;
    await flush();
    expect(f.parent.postMessage).toHaveBeenCalledTimes(2);
    f.respondIdentity(address, "PUBLIC");
    await second;
    expect(f.listeners.size).toBe(0);
  });
  it("does not interleave concurrent signing workflows", async () => {
    const f = frame();
    f.auto();
    const wallet = new LanternWallet("testnet", f.win);
    await wallet.getAddress();
    f.parent.postMessage.mockImplementation((message) => {
      if (message.type === "lantern:getPublicKey") f.respondIdentity();
    });
    const first = wallet.signTransaction(original, opts);
    const second = wallet.signTransaction(original, opts);
    await flush();
    const id = f.parent.postMessage.mock.calls.at(-1)![0].id;
    expect(
      f.parent.postMessage.mock.calls.filter(([m]) => m.type === "lantern:signXdr"),
    ).toHaveLength(1);
    f.auto();
    f.reply({ type: "lantern:signing", id });
    f.reply({ type: "lantern:xdrSigned", id, signedXdr: signed() });
    await first;
    await second;
    expect(f.parent.postMessage.mock.calls.map(([m]) => m.type)).toEqual([
      "lantern:getPublicKey",
      "lantern:getPublicKey",
      "lantern:signXdr",
      "lantern:getPublicKey",
      "lantern:getPublicKey",
      "lantern:signXdr",
      "lantern:getPublicKey",
    ]);
  });
  it("reports unsupported signing after 5 seconds, with no leaked listener", async () => {
    const f = frame();
    f.auto();
    const wallet = new LanternWallet("testnet", f.win);
    await wallet.getAddress();
    f.parent.postMessage.mockImplementation((message) => {
      if (message.type === "lantern:getPublicKey") f.respondIdentity();
    });
    const failure = expect(wallet.signTransaction(original, opts)).rejects.toThrow(
      LANTERN_SIGNING_UNSUPPORTED,
    );
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    await failure;
    expect(f.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("waits for acknowledged review then times out and ignores old signing IDs", async () => {
    const f = frame();
    f.auto();
    const wallet = new LanternWallet("testnet", f.win);
    await wallet.getAddress();
    f.parent.postMessage.mockImplementation((message) => {
      if (message.type === "lantern:getPublicKey") f.respondIdentity();
      else f.reply({ type: "lantern:signing", id: message.id });
    });
    const failure = expect(wallet.signTransaction(original, opts)).rejects.toThrow("timed out");
    await flush();
    const oldId = f.parent.postMessage.mock.calls.at(-1)![0].id;
    await vi.advanceTimersByTimeAsync(120000);
    await failure;
    await wallet.getAddress();
    const pending = wallet.signTransaction(original, opts);
    await flush();
    const id = f.parent.postMessage.mock.calls.at(-1)![0].id;
    expect(id).not.toBe(oldId);
    f.reply({ type: "lantern:xdrSigned", id: oldId, signedXdr: signed() });
    expect(f.listeners.size).toBe(1);
    f.auto();
    f.reply({ type: "lantern:xdrSigned", id, signedXdr: signed() });
    await pending;
  });
  it.each(["timeout", "abort", "disconnect"])(
    "quarantines ID-less %s connections so late replies cannot satisfy another request",
    async (reason) => {
      const f = frame();
      const a = new LanternWallet("testnet", f.win);
      const b = new LanternWallet("testnet", f.win);
      const controller = new AbortController();
      const failure = expect(a.getAddress({ signal: controller.signal })).rejects.toThrow(
        /timed out|cancelled/,
      );
      const queuedFailure = expect(b.getAddress()).rejects.toThrow("Reload");
      await flush();
      if (reason === "timeout") await vi.advanceTimersByTimeAsync(5000);
      else if (reason === "abort") controller.abort();
      else a.disconnect();
      await failure;
      await queuedFailure;
      f.respondIdentity(other.publicKey());
      await expect(new LanternWallet("testnet", f.win).getAddress()).rejects.toThrow("Reload");
      expect(f.parent.postMessage).toHaveBeenCalledTimes(1);
      expect(f.listeners.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("cancels queued requests without posting them or poisoning a healthy connection", async () => {
    const f = frame();
    const a = new LanternWallet("testnet", f.win);
    const b = new LanternWallet("testnet", f.win);
    const controller = new AbortController();
    const first = a.getAddress();
    const cancelled = expect(b.getAddress({ signal: controller.signal })).rejects.toThrow(
      "cancelled",
    );
    await flush();
    controller.abort();
    f.respondIdentity();
    await first;
    await cancelled;
    expect(f.parent.postMessage).toHaveBeenCalledTimes(1);
    f.auto();
    expect(await b.getAddress()).toEqual({ address });
  });
  it("connection rejection allows retry, and signing cancellation ignores late replies", async () => {
    const f = frame();
    const wallet = new LanternWallet("testnet", f.win);
    const rejected = expect(wallet.getAddress()).rejects.toThrow("rejected");
    await flush();
    f.reply({ type: "lantern:connectRejected" });
    await rejected;
    f.auto();
    await wallet.getAddress();
    f.parent.postMessage.mockImplementation((message) => {
      if (message.type === "lantern:getPublicKey") f.respondIdentity();
    });
    const failure = expect(wallet.signTransaction(original, opts)).rejects.toThrow("cancelled");
    await flush();
    wallet.disconnect();
    await failure;
    expect(f.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    f.auto();
    await wallet.getAddress();
    await wallet.signTransaction(original, opts);
  });
});
