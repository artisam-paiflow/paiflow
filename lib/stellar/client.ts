import "server-only";
import { rpc, Horizon, StrKey } from "@stellar/stellar-sdk";
import { beforeServiceSubmission, observeServiceTransaction } from "@/lib/deployments/service-work";
import { stellarHorizonUrl, stellarRpcUrl, stellarRelayerAddress } from "@/lib/env";
import { AppError } from "@/lib/errors";

const MAX_SAFE_SEQ = BigInt(Number.MAX_SAFE_INTEGER);

const g = globalThis as unknown as {
  __sorobanRpc?: rpc.Server;
  __horizon?: Horizon.Server;
  __relayerValidated?: boolean;
  __relayerPendingBarrier?: () => Promise<void>;
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

// The SDK's default is no timeout at all. Every cron walks its deployments in a
// sequential loop and the relayer helpers poll inside withRelayerLock(), so one
// socket that never answers would park a cron, or the whole relayer queue,
// until the process restarts (#559).
export const STELLAR_HTTP_TIMEOUT_MS = 10_000;
// A tenant's own charge-relayer endpoint (USER mode), which the auto-charge crons
// call from inside their per-deployment loop. Longer than one RPC call on
// purpose: the endpoint may answer `SUCCESS` with a tx hash, which means it
// signed, submitted and polled to finality before responding — our own finality
// poll alone is 30s. Cutting a healthy relayer off mid-poll would record a
// charge that landed on-chain as failed.
export const TENANT_RELAYER_TIMEOUT_MS = 45_000;

export function sorobanRpc(): rpc.Server {
  if (!g.__sorobanRpc) {
    g.__sorobanRpc = new rpc.Server(stellarRpcUrl(), { allowHttp: false });
    // Set on the HTTP client: SDK 16.3.1 still ignores rpc.Server's timeout option.
    g.__sorobanRpc.httpClient.defaults.timeout = STELLAR_HTTP_TIMEOUT_MS;
    const server = g.__sorobanRpc;
    const send = server.sendTransaction.bind(server);
    server.sendTransaction = async (transaction) => {
      const hash = transaction.hash().toString("hex");
      await beforeServiceSubmission(hash, "rpc");
      const result = await send(transaction);
      if (result.status === "ERROR" || result.status === "TRY_AGAIN_LATER")
        await observeServiceTransaction(hash, "REJECTED");
      return result;
    };
    const get = server.getTransaction.bind(server);
    server.getTransaction = async (hash) => {
      const result = await get(hash);
      if (result.status === "SUCCESS" || result.status === "FAILED")
        await observeServiceTransaction(hash, result.status, result.ledger);
      return result;
    };
    // Validate in background; don't block startup.
    validateRelayerSequence(g.__sorobanRpc).catch(() => {});
  }
  return g.__sorobanRpc;
}

export function horizon(): Horizon.Server {
  if (!g.__horizon) {
    g.__horizon = new Horizon.Server(stellarHorizonUrl(), { allowHttp: false });
    const server = g.__horizon;
    const submit = server.submitTransaction.bind(server);
    server.submitTransaction = async (transaction, options) => {
      const hash = transaction.hash().toString("hex");
      await beforeServiceSubmission(hash, "horizon");
      // A thrown transport error is deliberately left PENDING.
      const result = await submit(transaction, options);
      await observeServiceTransaction(hash, "SUCCESS", result.ledger);
      return result;
    };
    // Horizon.Server has no timeout option either. submitTransaction passes
    // its own 60s per request, which overrides this default.
    g.__horizon.httpClient.defaults.timeout = STELLAR_HTTP_TIMEOUT_MS;
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

/** Register source-lane reconciliation without importing channel code into the RPC client. */
export function registerRelayerPendingBarrier(barrier: () => Promise<void>): void {
  g.__relayerPendingBarrier = barrier;
}

export async function withRelayerLock<T>(fn: () => Promise<T>): Promise<T> {
  const promise = relayerQueue.then(async () => {
    await g.__relayerPendingBarrier?.();
    return fn();
  });
  relayerQueue = promise.then(
    () => {},
    () => {},
  );
  return promise;
}
