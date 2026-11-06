import { describe, expect, it, vi } from "vitest";
import type { WalletConnectModal } from "@walletconnect/modal";
import { pairWalletConnect } from "@/components/deploy/wallet-connect-pairing";
import type { WalletConnectClient } from "@/components/deploy/wallet-kit";

const address = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function session(topic: string, chain = "stellar:testnet") {
  return {
    topic,
    expiry: Date.now() / 1000 + 600,
    namespaces: { stellar: { accounts: [`${chain}:${address}`], methods: ["stellar_signXDR"] } },
  };
}
function fixture() {
  const sessions: ReturnType<typeof session>[] = [];
  const attempts: ReturnType<typeof deferred<ReturnType<typeof session>>>[] = [];
  const listeners = new Set<(state: { open: boolean }) => void>();
  const emit = (open: boolean) => {
    for (const listener of listeners) listener({ open });
  };
  const modal = {
    subscribeModal: vi.fn((listener: (state: { open: boolean }) => void) => {
      listeners.add(listener);
      listener({ open: false });
      return () => listeners.delete(listener);
    }),
    openModal: vi.fn(async () => emit(true)),
    closeModal: vi.fn(() => emit(false)),
  };
  const client = {
    session: { values: sessions },
    connect: vi.fn(async () => {
      const attempt = deferred<ReturnType<typeof session>>();
      attempts.push(attempt);
      return { uri: "wc:fixture", approval: () => attempt.promise };
    }),
    disconnect: vi.fn(async () => {}),
    request: vi.fn(),
  };
  const start = (signal = new AbortController().signal) =>
    pairWalletConnect(
      client as unknown as WalletConnectClient,
      modal as unknown as WalletConnectModal,
      "testnet",
      signal,
    );
  const approve = (index: number, topic: string, chain = "stellar:testnet") => {
    const approved = session(topic, chain);
    sessions.push(approved);
    attempts[index]!.resolve(approved);
  };
  return { client, modal, start, approve, emit, listeners, attempts };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("owned WalletConnect QR cancellation", () => {
  it("settles on QR close, cleans listeners and reconnects without adopting a late approval", async () => {
    const f = fixture();
    const first = f.start();
    await flush();
    f.emit(false);
    await expect(first).resolves.toBeNull();
    expect(f.listeners.size).toBe(0);
    const second = f.start();
    await flush();
    const closes = f.modal.closeModal.mock.calls.length;
    f.approve(0, "cancelled-topic");
    await flush();
    expect(f.modal.closeModal).toHaveBeenCalledTimes(closes);
    expect(f.client.disconnect).toHaveBeenCalledWith({
      topic: "cancelled-topic",
      reason: { code: 6000, message: "Connection attempt cancelled" },
    });
    f.approve(1, "new-topic");
    await expect(second).resolves.toEqual({ topic: "new-topic", address });
    expect(f.client.request).not.toHaveBeenCalled();
    expect(f.listeners.size).toBe(0);
  });

  it("treats the successful approval's programmatic close as success, not cancellation", async () => {
    const f = fixture();
    const result = f.start();
    await flush();
    f.approve(0, "chosen");
    await expect(result).resolves.toEqual({ topic: "chosen", address });
    expect(f.modal.closeModal).toHaveBeenCalledOnce();
    expect(f.client.disconnect).not.toHaveBeenCalled();
    expect(f.client.connect).toHaveBeenCalledWith({
      requiredNamespaces: {
        stellar: { methods: ["stellar_signXDR"], chains: ["stellar:testnet"], events: [] },
      },
    });
  });

  it("rejects concurrent pairings across surfaces without closing the active modal", async () => {
    const first = fixture();
    const second = fixture();
    const pending = first.start();
    await flush();
    await expect(second.start()).rejects.toThrow("in progress");
    expect(second.client.connect).not.toHaveBeenCalled();
    expect(first.modal.closeModal).not.toHaveBeenCalled();
    first.emit(false);
    await pending;
  });

  it("aborts before connect resolves and consumes its late approval without opening a QR", async () => {
    const f = fixture();
    const proposal = deferred<Awaited<ReturnType<typeof f.client.connect>>>();
    f.client.connect.mockReturnValueOnce(proposal.promise);
    const controller = new AbortController();
    const result = f.start(controller.signal);
    controller.abort();
    await expect(result).resolves.toBeNull();
    const approval = deferred<ReturnType<typeof session>>();
    proposal.resolve({ uri: "wc:late", approval: () => approval.promise });
    await flush();
    approval.resolve(session("late"));
    await flush();
    expect(f.modal.openModal).not.toHaveBeenCalled();
    expect(f.client.disconnect).toHaveBeenCalledWith(expect.objectContaining({ topic: "late" }));
  });

  it("does not disconnect a topic subsequently accepted by another attempt", async () => {
    const f = fixture();
    const first = f.start();
    await flush();
    f.emit(false);
    await first;
    const second = f.start();
    await flush();
    f.approve(1, "shared-topic");
    await second;
    f.approve(0, "shared-topic");
    await flush();
    expect(f.client.disconnect).not.toHaveBeenCalled();
  });

  it("handles rejected approval and modal-open failure without leaving the pairing locked", async () => {
    const f = fixture();
    f.modal.openModal.mockRejectedValueOnce(new Error("UI failed"));
    await expect(f.start()).rejects.toThrow("UI failed");
    expect(f.listeners.size).toBe(0);
    const next = f.start();
    await flush();
    f.attempts[0]!.reject(new Error("late rejection"));
    f.attempts[1]!.reject(new Error("wallet rejected"));
    await expect(next).rejects.toThrow("wallet rejected");
    expect(f.listeners.size).toBe(0);
  });

  it("rejects an unapproved network instead of falling back to another session", async () => {
    const f = fixture();
    const result = f.start();
    await flush();
    f.approve(0, "wrong-chain", "stellar:pubnet");
    await expect(result).rejects.toThrow("does not authorize");
    expect(f.client.request).not.toHaveBeenCalled();
    expect(f.client.disconnect).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "wrong-chain" }),
    );
  });

  it("keeps ownership until a cancelled asynchronous modal open settles", async () => {
    const f = fixture();
    const open = deferred<void>();
    f.modal.openModal.mockImplementationOnce(async () => {
      await open.promise;
      f.emit(true);
    });
    const controller = new AbortController();
    const first = f.start(controller.signal);
    await flush();
    controller.abort();
    await expect(first).resolves.toBeNull();
    await expect(f.start()).rejects.toThrow("in progress");
    open.resolve();
    await flush();
    const next = f.start();
    await flush();
    f.emit(false);
    await expect(next).resolves.toBeNull();
    expect(f.listeners.size).toBe(0);
  });

  it("still settles and releases ownership if modal cleanup throws", async () => {
    const f = fixture();
    f.modal.closeModal.mockImplementationOnce(() => {
      throw new Error("UI close failed");
    });
    const first = f.start();
    await flush();
    f.emit(false);
    await expect(first).resolves.toBeNull();
    const next = f.start();
    await flush();
    f.emit(false);
    await expect(next).resolves.toBeNull();
  });

  it("preserves sessions that existed before the cancelled attempt", async () => {
    const f = fixture();
    f.client.session.values.push(session("existing"));
    const result = f.start();
    await flush();
    f.emit(false);
    await result;
    f.approve(0, "existing");
    await flush();
    expect(f.client.disconnect).not.toHaveBeenCalled();
  });

  it("cleans a synchronous open/close subscription without reopening the cancelled QR", async () => {
    const f = fixture();
    const unsubscribe = vi.fn();
    f.modal.subscribeModal.mockImplementationOnce((listener) => {
      listener({ open: true });
      listener({ open: false });
      return unsubscribe;
    });
    await expect(f.start()).resolves.toBeNull();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(f.modal.openModal).not.toHaveBeenCalled();
  });
});
