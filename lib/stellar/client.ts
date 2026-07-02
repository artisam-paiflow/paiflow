import "server-only";
import { rpc, Horizon, StrKey } from "@stellar/stellar-sdk";
import { stellarHorizonUrl, stellarRpcUrl, stellarRelayerAddress } from "@/lib/env";
import { AppError } from "@/lib/errors";

const MAX_SAFE_SEQ = BigInt(Number.MAX_SAFE_INTEGER);

const g = globalThis as unknown as {
  __sorobanRpc?: rpc.Server;
  __horizon?: Horizon.Server;
  __relayerValidated?: boolean;
};

async function validateRelayerSequence(server: rpc.Server) {
  if (g.__relayerValidated) return;
  const addr = stellarRelayerAddress();
  if (!addr) return;
  try {
    const account = await server.getAccount(addr);
    const seq = BigInt(account.sequenceNumber());
    if (seq > MAX_SAFE_SEQ) {
      throw new Error(
        `Relayer account ${addr} has sequence ${seq.toString()}, which exceeds JavaScript's MAX_SAFE_INTEGER (${MAX_SAFE_SEQ.toString()}). ` +
          `This causes txBadSeq due to floating-point precision loss in XDR serialization. ` +
          `Generate a new relayer account, fund it, and update STELLAR_RELAYER_ADDRESS / STELLAR_RELAYER_SECRET_KEY.`,
      );
    }
    g.__relayerValidated = true;
  } catch (err) {
    if (err instanceof Error && err.message.includes("MAX_SAFE_INTEGER")) {
      throw err;
    }
    // Ignore other getAccount errors (e.g., network unavailable during startup)
  }
}

export function sorobanRpc(): rpc.Server {
  if (!g.__sorobanRpc) {
    g.__sorobanRpc = new rpc.Server(stellarRpcUrl(), { allowHttp: false });
    // Validate in background; don't block startup.
    validateRelayerSequence(g.__sorobanRpc).catch(() => {});
  }
  return g.__sorobanRpc;
}

export function horizon(): Horizon.Server {
  if (!g.__horizon) {
    g.__horizon = new Horizon.Server(stellarHorizonUrl(), { allowHttp: false });
  }
  return g.__horizon;
}

export function decodeContractAddress(addr: string): Buffer {
  if (StrKey.isValidContract(addr)) {
    return StrKey.decodeContract(addr);
  }
  const raw = Buffer.from(addr, "base64");
  if (raw.length === 32) {
    return raw;
  }
  throw new AppError("VALIDATION", `Invalid contract address: ${addr}`);
}

// Global promise chain to serialize submissions from the shared relayer account.
// It serializes account-load -> sign -> submit so concurrent async work in THIS
// process cannot interleave on the same sequence number (txBadSeq).
//
// SCOPE: this is an in-process, in-memory lock only — not a distributed lock.
// Each process/replica has its own `relayerQueue`, so if the app runs more than
// one instance (or a separate cron process) they can still race the relayer's
// sequence number against each other. Single-process/single-replica deployments
// are fully covered; multi-replica setups need a real distributed lock (or a
// dedicated single signer) on top of this.
let relayerQueue = Promise.resolve<unknown>(undefined);

export async function withRelayerLock<T>(fn: () => Promise<T>): Promise<T> {
  const promise = relayerQueue.then(() => fn());
  relayerQueue = promise.then(
    () => {},
    () => {},
  );
  return promise;
}
