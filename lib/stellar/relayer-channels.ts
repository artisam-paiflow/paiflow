import "server-only";
import {
  Address,
  BASE_FEE,
  Keypair,
  Operation,
  Transaction,
  TransactionBuilder,
  authorizeEntry,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { horizon, registerRelayerPendingBarrier, sorobanRpc, withRelayerLock } from "./client";
import {
  env,
  stellarPassphrase,
  stellarRelayerChannelCount,
  stellarRelayerSecretKey,
} from "@/lib/env";
import { AppError } from "@/lib/errors";
import { deriveChannelKeypair } from "./relayer-channel-keys";
import { log } from "@/lib/log";
import { reserveTransactionFee, ttlFeeBudget } from "@/lib/stellar/fee-budget";

/**
 * Relayer channel accounts.
 *
 * Stellar applies at most one transaction per source account per ledger, so a
 * single relayer source caps the platform at a few transactions a minute. With
 * `STELLAR_RELAYER_CHANNELS=N` the relayer signs only the Soroban authorization
 * entries and N derived channel accounts act as transaction source and fee
 * payer, one lock each. Contracts check `relayer.require_auth()`, never the
 * transaction source, so the contracts are unchanged.
 *
 * With `0` (the default) the relayer is its own source behind one lock, as it
 * was before channels existed.
 *
 * SCOPE: in-process, like `withRelayerLock`. A second replica has its own pool
 * and can still collide with this one (#202).
 */

/** How long a funded check is trusted before the next acquire re-checks it. */
const VERIFY_TTL_MS = 60_000;
/** How long an unfunded channel stays out of the pool before it is retried. */
const DISABLE_MS = 60_000;
const PENDING_WAIT_MS = 30_000;
const PENDING_POLL_MS = 1_000;
/** ~5 s per ledger, so this outlives the 180 s transaction timeout. */
const AUTH_LEDGER_MARGIN = 60;

export { deriveChannelKeypair };

export type RelayerChannel = {
  /** Transaction source and fee payer, and the key that signs the envelope. */
  keypair: Keypair;
  publicKey: string;
  /** The relayer key. Signs the Soroban auth entries that name the relayer. */
  relayerSigner: Keypair;
  /** `null` when the relayer is its own source (channels off, or none funded). */
  index: number | null;
  isRelayerSource: boolean;
  /**
   * Record a transaction sent but not yet final. The next holder of this
   * channel waits for it inside the lock, so its sequence number is current.
   */
  trackPending(txHash: string, maxTime?: string): void;
  /** Clear only this known final/rejected transaction; leave other work intact. */
  clearPending?(txHash: string): void;
};

function requireRelayerKeypair(): Keypair {
  const secret = stellarRelayerSecretKey();
  if (!secret) {
    throw new AppError("INTERNAL", "STELLAR_RELAYER_SECRET_KEY is not configured");
  }
  return Keypair.fromSecret(secret);
}

/** The relayer as its own source: today's behaviour, and the fallback lane. */
export function relayerSourceChannel(): RelayerChannel {
  registerRelayerPendingBarrier(async () => {
    if (g.__relayerSourcePending) await waitForPending(g.__relayerSourcePending);
  });
  const kp = requireRelayerKeypair();
  if (g.__relayerSourcePending?.address !== kp.publicKey()) {
    g.__relayerSourcePending = { address: kp.publicKey(), pendingHash: null, pendingMaxTime: null };
  }
  const pending = g.__relayerSourcePending;
  return {
    keypair: kp,
    publicKey: kp.publicKey(),
    relayerSigner: kp,
    index: null,
    isRelayerSource: true,
    trackPending: (hash, maxTime) => {
      pending.pendingHash = hash;
      pending.pendingMaxTime = maxTime ?? null;
    },
    clearPending: (hash) => {
      if (pending.pendingHash === hash) pending.pendingHash = null;
    },
  };
}

type Slot = {
  index: number;
  channel: RelayerChannel;
  busy: boolean;
  disabledUntil: number;
  verifiedAt: number;
  warned: boolean;
  pendingHash: string | null;
  pendingMaxTime: string | null;
};

type Pool = {
  slots: Slot[];
  waiters: Array<() => void>;
  lastFallbackWarnAt: number;
};

const g = globalThis as unknown as {
  __relayerChannelPool?: Pool;
  __relayerSourcePending?: {
    address: string;
    pendingHash: string | null;
    pendingMaxTime: string | null;
  };
};

function getPool(): Pool {
  const count = stellarRelayerChannelCount();
  const existing = g.__relayerChannelPool;
  if (existing && existing.slots.length === count) return existing;
  const secret = stellarRelayerSecretKey();
  if (!secret) {
    throw new AppError("INTERNAL", "STELLAR_RELAYER_SECRET_KEY is not configured");
  }
  const relayer = Keypair.fromSecret(secret);
  const slots: Slot[] = [];
  for (let i = 0; i < count; i++) {
    const kp = deriveChannelKeypair(secret, i);
    const slot: Slot = {
      index: i,
      busy: false,
      disabledUntil: 0,
      verifiedAt: 0,
      warned: false,
      pendingHash: null,
      pendingMaxTime: null,
      channel: {
        keypair: kp,
        publicKey: kp.publicKey(),
        relayerSigner: relayer,
        index: i,
        isRelayerSource: false,
        trackPending: (hash, maxTime) => {
          slot.pendingHash = hash;
          slot.pendingMaxTime = maxTime ?? null;
        },
        clearPending: (hash) => {
          if (slot.pendingHash === hash) slot.pendingHash = null;
        },
      },
    };
    slots.push(slot);
  }
  const pool: Pool = { slots, waiters: [], lastFallbackWarnAt: 0 };
  g.__relayerChannelPool = pool;
  return pool;
}

/** Test hook: forget the pool so the next call rebuilds it from env. */
export function resetRelayerChannelPoolForTests(): void {
  delete g.__relayerChannelPool;
  delete g.__relayerSourcePending;
}

function isMissingAccount(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /not found|404/i.test(msg);
}

/** False only when the RPC says the account does not exist; other errors are not held against the channel. */
async function slotUsable(slot: Slot): Promise<boolean> {
  const now = Date.now();
  if (now - slot.verifiedAt < VERIFY_TTL_MS) return true;
  try {
    await sorobanRpc().getAccount(slot.channel.publicKey);
    slot.verifiedAt = now;
    slot.warned = false;
    return true;
  } catch (err) {
    if (!isMissingAccount(err)) return true;
    slot.disabledUntil = now + DISABLE_MS;
    if (!slot.warned) {
      slot.warned = true;
      log.warn(
        { channel: slot.index, address: slot.channel.publicKey },
        "relayer channel is not funded; skipping it (run pnpm relayer:channels)",
      );
    }
    return false;
  }
}

function wake(pool: Pool): void {
  const next = pool.waiters.shift();
  if (next) next();
}

/** A free, funded slot, or `null` when every channel is unfunded. Waits while the rest are busy. */
async function acquire(pool: Pool): Promise<Slot | null> {
  for (;;) {
    const now = Date.now();
    const free = pool.slots.find((s) => !s.busy && s.disabledUntil <= now);
    if (free) {
      free.busy = true;
      let ok = false;
      try {
        ok = await slotUsable(free);
      } catch (err) {
        free.busy = false;
        wake(pool);
        throw err;
      }
      if (!ok) {
        free.busy = false;
        wake(pool);
        continue;
      }
      return free;
    }
    if (pool.slots.every((s) => s.disabledUntil > now && !s.busy)) {
      // Nothing will ever release: pass the wake on so every queued caller
      // reaches this same conclusion instead of waiting for a release.
      wake(pool);
      return null;
    }
    await new Promise<void>((resolve) => pool.waiters.push(resolve));
  }
}

function release(pool: Pool, slot: Slot): void {
  slot.busy = false;
  wake(pool);
}

async function waitForPending(slot: {
  pendingHash: string | null;
  pendingMaxTime: string | null;
}): Promise<void> {
  const hash = slot.pendingHash;
  if (!hash) return;
  const server = sorobanRpc();
  const deadline = Date.now() + PENDING_WAIT_MS;
  while (Date.now() < deadline) {
    const got = await server.getTransaction(hash);
    if (got.status === "SUCCESS" || got.status === "FAILED") {
      slot.pendingHash = null;
      return;
    }
    // An ambiguous rent submit may never have arrived. Only a CLOSED ledger
    // beyond the signed envelope's upper time bound proves it cannot land now.
    // This releases the source lane; it does not classify or retry that work.
    if (
      got.status === "NOT_FOUND" &&
      slot.pendingMaxTime &&
      /^\d+$/.test(slot.pendingMaxTime) &&
      BigInt(slot.pendingMaxTime) > 0n
    ) {
      const latest = await server.getLatestLedger();
      if (
        typeof latest.closeTime === "string" &&
        /^\d+$/.test(latest.closeTime) &&
        BigInt(latest.closeTime) <= 0xffff_ffff_ffff_ffffn &&
        BigInt(latest.closeTime) > BigInt(slot.pendingMaxTime)
      ) {
        slot.pendingHash = null;
        return;
      }
    }
    await new Promise((r) => setTimeout(r, PENDING_POLL_MS));
  }
  throw new AppError("UPSTREAM_RPC", "Previous relayer transaction finality is unknown");
}

async function withRelayerSource<T>(fn: (channel: RelayerChannel) => Promise<T>): Promise<T> {
  return withRelayerLock(async () => {
    const channel = relayerSourceChannel();
    return fn(channel);
  });
}

/**
 * Run `fn` with exclusive use of one relayer channel as the transaction
 * source. At most N callers run at once, one per channel; the rest queue.
 * Keep the whole load-account -> sign -> send (-> finality) sequence inside
 * `fn`, exactly as inside the old `withRelayerLock`.
 *
 * With channels off, or when no channel is funded, `fn` gets the relayer as its
 * own source behind the single relayer lock.
 */
export async function withRelayerChannel<T>(
  fn: (channel: RelayerChannel) => Promise<T>,
): Promise<T> {
  if (stellarRelayerChannelCount() === 0) {
    return withRelayerSource(fn);
  }
  const pool = getPool();
  const slot = await acquire(pool);
  if (!slot) {
    const now = Date.now();
    if (now - pool.lastFallbackWarnAt > DISABLE_MS) {
      pool.lastFallbackWarnAt = now;
      log.warn("no funded relayer channel; using the relayer account as source");
    }
    return withRelayerSource(fn);
  }
  try {
    await waitForPending(slot);
    return await fn(slot.channel);
  } catch (err) {
    if (err instanceof AppError && err.code === "INSUFFICIENT_FUNDS") {
      slot.disabledUntil = Date.now() + DISABLE_MS;
      slot.verifiedAt = 0;
      log.warn(
        { channel: slot.index, address: slot.channel.publicKey },
        "relayer channel ran out of funds; skipping it for a minute",
      );
    }
    throw err;
  } finally {
    release(pool, slot);
  }
}

export type RelayerRestorationRecord = {
  hash: string;
  payer: string;
  declaredFeeStroops: string;
};
export type RelayerRestorationOutcome = RelayerRestorationRecord & {
  status: "SUCCESS" | "FAILED";
  netFeeStroops: string;
  ledger: number;
};
export type RelayerRestorationObserver = {
  beforeSend: (record: RelayerRestorationRecord) => Promise<void>;
  onFinality: (outcome: RelayerRestorationOutcome) => Promise<void>;
};

export type BuildRelayerTxOptions = {
  channel: RelayerChannel;
  operation: xdr.Operation;
  timeoutSeconds?: number;
  onSimulationError: (message: string) => Error;
  /** Relayer-source lane only: reuse a simulation taken earlier instead of simulating again. */
  presimulated?: rpc.Api.SimulateTransactionSuccessResponse;
  /** Public evidence only; persist before sending and immediately on finality. */
  restorationObserver?: RelayerRestorationObserver;
};

function credentialAddress(entry: xdr.SorobanAuthorizationEntry): string | null {
  const creds = entry.credentials();
  if (creds.switch().name !== "sorobanCredentialsAddress") return null;
  return Address.fromScAddress(creds.address().address()).toString();
}

/**
 * Build, simulate, authorize and sign a single-operation relayer transaction.
 *
 * On the relayer lane the relayer is the source, so simulation returns
 * source-account credentials and the envelope signature covers them (the
 * pre-channel behaviour, unchanged). With a channel as source the relayer is
 * only an address: simulation returns address credentials for it, which are
 * signed with `authorizeEntry`, then the transaction is simulated again so the
 * footprint and resource fee cover the signature check, and the channel signs
 * the envelope. Entries for any other address (a user's pre-signed auth) are
 * left as they came.
 */
export async function buildRelayerTx(opts: BuildRelayerTxOptions): Promise<Transaction> {
  return buildRelayerTxAttempt(opts, true);
}

/** Restore only before submission, then rebuild once; never retry a payment. */
async function buildRelayerTxAttempt(
  opts: BuildRelayerTxOptions,
  mayRestore: boolean,
): Promise<Transaction> {
  const { channel } = opts;
  const server = sorobanRpc();
  const passphrase = stellarPassphrase();
  const timeout = opts.timeoutSeconds ?? 180;
  const maxFee = env().STELLAR_RELAYER_MAX_FEE_STROOPS;
  const assertFee = (transaction: Transaction) => {
    if (maxFee !== undefined && BigInt(transaction.fee) > BigInt(maxFee)) {
      throw opts.onSimulationError("Relayer transaction exceeds the configured total fee limit");
    }
  };

  const restoreAndRebuild = async (sim: rpc.Api.SimulateTransactionRestoreResponse) => {
    if (maxFee !== undefined) {
      throw opts.onSimulationError(
        "Automatic restoration is disabled while a relayer total fee limit is configured",
      );
    }
    if (!mayRestore) {
      throw opts.onSimulationError("Archived state still requires restoration after one restore");
    }
    await restoreRelayerFootprint(
      server,
      channel,
      sim,
      passphrase,
      opts.onSimulationError,
      opts.restorationObserver,
    );
    // Restoration consumed a sequence number and changed the ledger. Discard
    // the probe's footprint and every recorded relayer authorization.
    return buildRelayerTxAttempt({ ...opts, presimulated: undefined }, false);
  };

  let sourceAcct;
  try {
    sourceAcct = await server.getAccount(channel.publicKey);
  } catch {
    throw new AppError(
      "INSUFFICIENT_FUNDS",
      channel.isRelayerSource
        ? `Relayer account ${channel.publicKey} is not funded or does not exist`
        : `Relayer channel ${channel.index} (${channel.publicKey}) is not funded or does not exist`,
    );
  }

  const tx = new TransactionBuilder(sourceAcct, { fee: BASE_FEE, networkPassphrase: passphrase })
    .addOperation(opts.operation)
    .setTimeout(timeout)
    .build();

  if (channel.isRelayerSource) {
    const sim = opts.presimulated ?? (await server.simulateTransaction(tx));
    if (rpc.Api.isSimulationError(sim)) throw opts.onSimulationError(sim.error);
    if (rpc.Api.isSimulationRestore(sim)) return restoreAndRebuild(sim);
    const assembled = rpc.assembleTransaction(tx, sim).build();
    assertFee(assembled);
    assembled.sign(channel.keypair);
    return assembled;
  }

  // Simulate with no auth attached so the RPC records every address that must
  // authorize, the relayer included. On the relayer lane an implicit
  // source-account credential covers `relayer.require_auth()`; here it does
  // not, so a caller-supplied list (a webhook's user-signed entry for `from`)
  // cannot be simulated as-is: it would fail for the missing relayer entry.
  const envelope = tx.toEnvelope();
  const invokeOp = envelope.v1().tx().operations()[0]?.body().invokeHostFunctionOp();
  if (!invokeOp) {
    throw new AppError("INTERNAL", "Relayer channel transactions must be a single contract call");
  }
  const supplied = [...invokeOp.auth()];
  invokeOp.auth([]);
  const sim1 = await server.simulateTransaction(new Transaction(envelope, passphrase));
  if (rpc.Api.isSimulationError(sim1)) throw opts.onSimulationError(sim1.error);
  if (rpc.Api.isSimulationRestore(sim1)) return restoreAndRebuild(sim1);

  const relayerAddress = channel.relayerSigner.publicKey();
  const validUntil = sim1.latestLedger + AUTH_LEDGER_MARGIN;
  const finalAuth: xdr.SorobanAuthorizationEntry[] = [];
  for (const recorded of sim1.result?.auth ?? []) {
    const who = credentialAddress(recorded);
    if (who !== null && who === relayerAddress) {
      finalAuth.push(await authorizeEntry(recorded, channel.relayerSigner, validUntil, passphrase));
    } else {
      // Another address: use the caller's already-signed entry for it if there
      // is one, otherwise keep the unsigned recording and let simulation reject it.
      finalAuth.push(
        supplied.find((e) => who !== null && credentialAddress(e) === who) ?? recorded,
      );
    }
  }
  invokeOp.auth(finalAuth);

  const authorized = new Transaction(envelope, passphrase);
  const sim2 = await server.simulateTransaction(authorized);
  if (rpc.Api.isSimulationError(sim2)) throw opts.onSimulationError(sim2.error);
  if (rpc.Api.isSimulationRestore(sim2)) return restoreAndRebuild(sim2);
  const assembled = rpc.assembleTransaction(authorized, sim2).build();
  assertFee(assembled);
  assembled.sign(channel.keypair);
  return assembled;
}

async function restoreRelayerFootprint(
  server: rpc.Server,
  channel: RelayerChannel,
  sim: rpc.Api.SimulateTransactionRestoreResponse,
  passphrase: string,
  onError: (message: string) => Error,
  observer?: RelayerRestorationObserver,
): Promise<void> {
  const account = await server.getAccount(channel.publicKey);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: passphrase })
    .setSorobanData(sim.restorePreamble.transactionData.build())
    .addOperation(Operation.restoreFootprint({}))
    .setTimeout(180)
    .build();
  const restoreSim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(restoreSim)) throw onError(restoreSim.error);
  if (rpc.Api.isSimulationRestore(restoreSim)) {
    throw onError("Restoration simulation unexpectedly requires restoration");
  }
  const assembled = rpc.assembleTransaction(tx, restoreSim).build();
  if (BigInt(assembled.fee) > BigInt(env().STELLAR_TTL_MAX_FEE_STROOPS)) {
    throw onError("Archived state restoration exceeds the configured maintenance fee limit");
  }
  const hash = assembled.hash().toString("hex");
  const budget = ttlFeeBudget(env().STELLAR_TTL_MAX_FEE_STROOPS);
  if (budget) {
    await reserveTransactionFee({
      network: env().STELLAR_NETWORK,
      budget,
      txHash: hash,
      payer: channel.publicKey,
      declaredFeeStroops: assembled.fee,
      purpose: "ttl-restoration",
    });
  }
  assembled.sign(channel.keypair);
  const record = { hash, payer: channel.publicKey, declaredFeeStroops: assembled.fee };
  await observer?.beforeSend(record);
  // Record before sending: transport failure can leave a submitted restore
  // with unknown finality. The next channel holder must reconcile that hash.
  channel.trackPending(hash, assembled.timeBounds?.maxTime);
  const sent = await server.sendTransaction(assembled);
  if (sent.status === "ERROR") {
    channel.clearPending?.(hash);
    throw onError("Archived state restoration was rejected");
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const got = await server.getTransaction(hash);
    if (got.status === "SUCCESS" || got.status === "FAILED") {
      channel.clearPending?.(hash);
      await observer?.onFinality({
        ...record,
        status: got.status,
        netFeeStroops: got.resultXdr.feeCharged().toString(),
        ledger: got.ledger,
      });
      if (got.status === "SUCCESS") return;
      throw onError("Archived state restoration failed on the network");
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw onError("Archived state restoration finality is unknown; invocation was not submitted");
}

export type RelayerChannelBalance = {
  index: number;
  address: string;
  funded: boolean;
  balanceXlm: string | null;
};

/** Derived channel addresses and their native balances. Public data; never returns a key. */
export async function relayerChannelBalances(): Promise<RelayerChannelBalance[]> {
  const count = stellarRelayerChannelCount();
  const secret = stellarRelayerSecretKey();
  if (count === 0 || !secret) return [];
  const server = horizon();
  const out: RelayerChannelBalance[] = [];
  for (let i = 0; i < count; i++) {
    const address = deriveChannelKeypair(secret, i).publicKey();
    try {
      const acct = await server.loadAccount(address);
      const native = acct.balances.find((b) => b.asset_type === "native");
      out.push({ index: i, address, funded: true, balanceXlm: native?.balance ?? "0" });
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      // Only a 404 means the account does not exist; anything else is unknown.
      out.push({ index: i, address, funded: status !== 404, balanceXlm: null });
    }
  }
  return out;
}

const LOW_BALANCE_XLM = 5;
let healthCache: { at: number; value: { configured: number; funded: number } } | null = null;
let healthInflight: Promise<{ configured: number; funded: number }> | null = null;

/**
 * Cheap summary for /api/health, cached so a busy probe cannot fan out to
 * Horizon. Logs each channel's balance when it refreshes and warns about
 * unfunded or low channels.
 */
export async function relayerChannelHealth(): Promise<{ configured: number; funded: number }> {
  const configured = stellarRelayerChannelCount();
  if (configured === 0) return { configured: 0, funded: 0 };
  const now = Date.now();
  if (healthCache && now - healthCache.at < VERIFY_TTL_MS) return healthCache.value;
  healthInflight ??= refreshHealth(configured).finally(() => {
    healthInflight = null;
  });
  return healthInflight;
}

async function refreshHealth(configured: number): Promise<{ configured: number; funded: number }> {
  const now = Date.now();
  const balances = await relayerChannelBalances();
  const funded = balances.filter((b) => b.funded).length;
  for (const b of balances) {
    if (!b.funded) {
      log.warn({ channel: b.index, address: b.address }, "relayer channel is not funded");
    } else if (b.balanceXlm !== null && Number(b.balanceXlm) < LOW_BALANCE_XLM) {
      log.warn(
        { channel: b.index, address: b.address, balanceXlm: b.balanceXlm },
        "relayer channel balance is low",
      );
    } else {
      log.info(
        { channel: b.index, address: b.address, balanceXlm: b.balanceXlm },
        "relayer channel balance",
      );
    }
  }
  healthCache = { at: now, value: { configured, funded } };
  return healthCache.value;
}
