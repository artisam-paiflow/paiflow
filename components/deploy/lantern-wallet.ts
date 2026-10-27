"use client";

import { LANTERN_PARENT_ORIGINS } from "@/lib/csp";
import { LanternWalletError } from "@/lib/stellar/lantern-wallet-error";
import {
  assertSignedWalletTransaction,
  assertWalletNetwork,
  preparedWalletTransactionHash,
} from "@/lib/stellar/wallet-signature";
import { isStellarPublicKey } from "@/lib/stellar/lantern-bridge-validation";

type Network = "testnet" | "mainnet";
type ParentOrigin = (typeof LANTERN_PARENT_ORIGINS)[number];
type Identity = { address: string; network: "TESTNET" | "PUBLIC" };
type Reply = Record<string, unknown>;

const ACK_TIMEOUT_MS = 5_000;
const REVIEW_TIMEOUT_MS = 120_000;
const RELOAD_REQUIRED =
  "Lantern connection was interrupted. Reload Paiflow inside Lantern before connecting again.";
export const LANTERN_SIGNING_UNSUPPORTED =
  "This Lantern build did not acknowledge transaction signing. Update Lantern and reopen Paiflow in its Apps tab.";

function approvedOrigin(value: string): ParentOrigin | null {
  try {
    const url = new URL(value);
    // URL.origin is "null" for chrome-extension in some browser runtimes.
    const origin = `${url.protocol}//${url.host}`;
    return LANTERN_PARENT_ORIGINS.find((allowed) => allowed === origin) ?? null;
  } catch {
    return null;
  }
}

/** Parent-frame selection only; this never establishes Paiflow authentication. */
export function trustedLanternOrigin(
  win: Window | undefined = typeof window === "undefined" ? undefined : window,
): ParentOrigin | null {
  if (!win || win.parent === win) return null;
  // The first ancestor is the immediate parent, not an outer Lantern frame.
  const ancestors = win.location.ancestorOrigins;
  if (ancestors?.length) return approvedOrigin(ancestors[0] ?? "");
  return approvedOrigin(win.document.referrer);
}

function record(value: unknown): value is Reply {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function cancelled(): Error {
  return new Error("Lantern wallet request cancelled.");
}

/** All adapters in one frame share a queue: connect replies have no request ID. */
class Bridge {
  private tail: Promise<unknown> = Promise.resolve();
  private connectionInterrupted = false;

  constructor(
    private readonly win: Window,
    private readonly origin: ParentOrigin,
  ) {}

  enqueue<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    const next = this.tail.then(() => {
      if (signal.aborted) throw cancelled();
      if (this.connectionInterrupted) throw new Error(RELOAD_REQUIRED);
      return task();
    });
    this.tail = next.catch(() => undefined);
    // Cancel queued callers immediately, but keep their place in the queue.
    // Releasing the queue early would overlap an active wallet prompt.
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(cancelled());
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      next.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }

  request(message: Reply, signal: AbortSignal): Promise<Reply> {
    if (signal.aborted) return Promise.reject(cancelled());
    const signing = message.type === "lantern:signXdr";
    return new Promise((resolve, reject) => {
      let acknowledged = false;
      let sent = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (reply?: Reply, error?: Error, interrupted = false) => {
        clearTimeout(timer);
        this.win.removeEventListener("message", receive);
        signal.removeEventListener("abort", abort);
        // An ID-less late approval must never satisfy the next connection.
        if (interrupted && sent && !signing) this.connectionInterrupted = true;
        if (error) reject(error);
        else resolve(reply!);
      };
      const abort = () => finish(undefined, cancelled(), true);
      const timeout = () =>
        finish(
          undefined,
          new Error(
            signing && !acknowledged
              ? LANTERN_SIGNING_UNSUPPORTED
              : "Lantern wallet request timed out. Its outcome is unknown; check the transaction status before signing again." +
                  (signing ? "" : " Reload Paiflow before reconnecting."),
          ),
          true,
        );
      const receive = (event: MessageEvent<unknown>) => {
        if (event.source !== this.win.parent || event.origin !== this.origin || !record(event.data))
          return;
        const reply = event.data;
        if (signing && reply.id !== message.id) return;
        if (reply.type === (signing ? "lantern:signing" : "lantern:connecting")) {
          if (!acknowledged) {
            acknowledged = true;
            clearTimeout(timer);
            timer = setTimeout(timeout, REVIEW_TIMEOUT_MS);
          }
          return;
        }
        if (!signing) {
          if (reply.type === "lantern:connectRejected") {
            // Identity reads also happen after a signature was returned. A
            // connection refusal never proves the transaction was not signed.
            finish(
              undefined,
              new Error("Lantern wallet connection rejected. Reconnect before continuing."),
            );
          } else if (
            reply.type === "lantern:publicKey" &&
            typeof reply.publicKey === "string" &&
            isStellarPublicKey(reply.publicKey) &&
            (reply.network === "TESTNET" || reply.network === "PUBLIC")
          ) {
            finish(reply);
          }
        } else if (
          reply.type === "lantern:signRejected" &&
          (reply.error === undefined || typeof reply.error === "string")
        ) {
          finish(
            undefined,
            reply.error === undefined
              ? new LanternWalletError("LANTERN_REJECTED")
              : new LanternWalletError("LANTERN_REQUEST_FAILED"),
          );
        } else if (reply.type === "lantern:txError" && typeof reply.error === "string") {
          finish(undefined, new LanternWalletError("LANTERN_REQUEST_FAILED"));
        } else if (
          acknowledged &&
          reply.type === "lantern:xdrSigned" &&
          typeof reply.signedXdr === "string" &&
          reply.signedXdr.length > 0 &&
          reply.signedXdr.length <= 200_000
        ) {
          finish(reply);
        }
      };
      this.win.addEventListener("message", receive);
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(timeout, ACK_TIMEOUT_MS);
      try {
        sent = true;
        this.win.parent.postMessage(message, this.origin);
      } catch {
        finish(
          undefined,
          new Error("Could not contact Lantern. Reload Paiflow in its Apps tab."),
          true,
        );
      }
    });
  }
}

const bridges = new WeakMap<Window, Bridge>();

export class LanternWallet {
  readonly id = "lantern";
  private identity: Identity | null = null;
  private lifecycle = new AbortController();
  private readonly bridge: Bridge;

  constructor(
    readonly network: Network,
    win: Window = window,
  ) {
    const origin = trustedLanternOrigin(win);
    if (!origin) throw new Error("Open Paiflow in Lantern's Apps tab to use the Lantern wallet.");
    let bridge = bridges.get(win);
    if (!bridge) {
      bridge = new Bridge(win, origin);
      bridges.set(win, bridge);
    }
    this.bridge = bridge;
  }

  private run<T>(task: (signal: AbortSignal) => Promise<T>, external?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const lifecycle = this.lifecycle.signal;
    const abort = () => controller.abort();
    lifecycle.addEventListener("abort", abort, { once: true });
    external?.addEventListener("abort", abort, { once: true });
    if (lifecycle.aborted || external?.aborted) abort();
    return this.bridge
      .enqueue(() => task(controller.signal), controller.signal)
      .finally(() => {
        lifecycle.removeEventListener("abort", abort);
        external?.removeEventListener("abort", abort);
      });
  }

  private async readIdentity(signal: AbortSignal): Promise<Identity> {
    const reply = await this.bridge.request({ type: "lantern:getPublicKey" }, signal);
    if (signal.aborted) throw cancelled();
    const identity = {
      address: reply.publicKey as string,
      network: reply.network as Identity["network"],
    };
    if (identity.network !== (this.network === "testnet" ? "TESTNET" : "PUBLIC")) {
      this.identity = null;
      throw new Error(
        `Switch Lantern to ${this.network === "testnet" ? "Testnet" : "Mainnet"} and reconnect the wallet.`,
      );
    }
    return identity;
  }

  /** Explicit wallet connection, never login or proof of account ownership. */
  getAddress(options?: { signal?: AbortSignal }): Promise<{ address: string }> {
    return this.run(async (signal) => {
      this.identity = null;
      const identity = await this.readIdentity(signal);
      if (signal.aborted) throw cancelled();
      this.identity = identity;
      return { address: this.identity.address };
    }, options?.signal);
  }

  signTransaction(
    xdr: string,
    options: { networkPassphrase: string; address?: string; signal?: AbortSignal },
  ): Promise<{ signedTxXdr: string }> {
    return this.run(async (signal) => {
      const expected = this.identity;
      if (!expected) throw new Error("Connect the Lantern wallet before signing.");
      const passphrase = options.networkPassphrase;
      assertWalletNetwork(this.network, passphrase);
      if (options.address !== undefined && options.address !== expected.address)
        throw new Error(
          "Transaction account does not match the connected Lantern wallet. Reconnect before signing.",
        );
      if (typeof xdr !== "string" || !xdr.length || xdr.length > 200_000)
        throw new Error("Missing or invalid transaction XDR.");
      // Reject unsupported envelopes/source before exposing them to the parent.
      try {
        preparedWalletTransactionHash(this.network, xdr, expected.address, passphrase);
      } catch {
        throw new LanternWalletError("LANTERN_INVALID_REQUEST");
      }
      const checkIdentity = async () => {
        const current = await this.readIdentity(signal);
        if (current.address !== expected.address || current.network !== expected.network) {
          this.identity = null;
          throw new Error(
            "Lantern account or network changed. Reconnect the wallet before preparing another transaction.",
          );
        }
      };
      try {
        // Lantern has no change event; revalidate before exposing the envelope.
        await checkIdentity();
        const reply = await this.bridge.request(
          { type: "lantern:signXdr", xdr, networkPassphrase: passphrase, id: crypto.randomUUID() },
          signal,
        );
        const signedTxXdr = reply.signedXdr as string;
        try {
          assertSignedWalletTransaction(xdr, signedTxXdr, expected.address, passphrase);
        } catch {
          throw new LanternWalletError("LANTERN_INVALID_RESPONSE");
        }
        await checkIdentity();
        if (signal.aborted) throw cancelled();
        return { signedTxXdr };
      } catch (error) {
        this.identity = null;
        throw error;
      }
    }, options.signal);
  }

  disconnect(): void {
    this.identity = null;
    this.lifecycle.abort();
    this.lifecycle = new AbortController();
  }
}

/** Select before initializing browser wallet SDKs; callers wire public flows in #931. */
export function selectLanternWallet(network: Network): LanternWallet | null {
  return trustedLanternOrigin() ? new LanternWallet(network) : null;
}
