import "server-only";
import { createHash } from "node:crypto";
import {
  Address,
  BASE_FEE,
  Keypair,
  Transaction,
  TransactionBuilder,
  authorizeEntry,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { horizon, sorobanRpc, withRelayerLock } from "./client";
import { stellarPassphrase, stellarRelayerChannelCount, stellarRelayerSecretKey } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";

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

const KEY_DOMAIN = "paiflow-relayer-channel:";
/** How long a funded check is trusted before the next acquire re-checks it. */
const VERIFY_TTL_MS = 60_000;
/** How long an unfunded channel stays out of the pool before it is retried. */
const DISABLE_MS = 60_000;
const PENDING_WAIT_MS = 30_000;
const PENDING_POLL_MS = 1_000;
/** ~5 s per ledger, so this outlives the 180 s transaction timeout. */
const AUTH_LEDGER_MARGIN = 60;

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
   * A no-op on the relayer lane, which behaves as it did before channels.
   */
  trackPending(txHash: string): void;
};

/**
 * Deterministic channel key: a raw ed25519 seed from
 * sha256(relayerSeed || domain || index). No new secret to store or rotate;
 * the channel keys are exactly as sensitive as the relayer secret itself.
 */
export function deriveChannelKeypair(relayerSecret: string, index: number): Keypair {
  if (!Number.isInteger(index) || index < 0) {
    throw new AppError("INTERNAL", "Relayer channel index must be a non-negative integer");
  }
  const seed = Keypair.fromSecret(relayerSecret).rawSecretKey();
  const digest = createHash("sha256")
    .update(seed)
    .update(KEY_DOMAIN)
    .update(String(index))
    .digest();
  return Keypair.fromRawEd25519Seed(digest);
}

function requireRelayerKeypair(): Keypair {
  const secret = stellarRelayerSecretKey();
  if (!secret) {
    throw new AppError("INTERNAL", "STELLAR_RELAYER_SECRET_KEY is not configured");
  }
  return Keypair.fromSecret(secret);
}

/** The relayer as its own source: today's behaviour, and the fallback lane. */
export function relayerSourceChannel(): RelayerChannel {
  const kp = requireRelayerKeypair();
  return {
    keypair: kp,
    publicKey: kp.publicKey(),
    relayerSigner: kp,
    index: null,
    isRelayerSource: true,
    trackPending: () => {},
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
};

type Pool = {
  slots: Slot[];
  waiters: Array<() => void>;
  lastFallbackWarnAt: number;
};

const g = globalThis as unknown as { __relayerChannelPool?: Pool };

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
      channel: {
        keypair: kp,
        publicKey: kp.publicKey(),
        relayerSigner: relayer,
        index: i,
        isRelayerSource: false,
        trackPending: (hash) => {
          slot.pendingHash = hash;
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
    if (pool.slots.every((s) => s.disabledUntil > now && !s.busy)) return null;
    await new Promise<void>((resolve) => pool.waiters.push(resolve));
  }
}

function release(pool: Pool, slot: Slot): void {
  slot.busy = false;
  wake(pool);
}

async function waitForPending(slot: Slot): Promise<void> {
  const hash = slot.pendingHash;
  if (!hash) return;
  slot.pendingHash = null;
  const server = sorobanRpc();
  const deadline = Date.now() + PENDING_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const got = await server.getTransaction(hash);
      if (got.status !== "NOT_FOUND") return;
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, PENDING_POLL_MS));
  }
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
    return withRelayerLock(() => fn(relayerSourceChannel()));
  }
  const pool = getPool();
  const slot = await acquire(pool);
  if (!slot) {
    const now = Date.now();
    if (now - pool.lastFallbackWarnAt > DISABLE_MS) {
      pool.lastFallbackWarnAt = now;
      log.warn("no funded relayer channel; using the relayer account as source");
    }
    return withRelayerLock(() => fn(relayerSourceChannel()));
  }
  try {
    await waitForPending(slot);
    return await fn(slot.channel);
  } finally {
    release(pool, slot);
  }
}

export type BuildRelayerTxOptions = {
  channel: RelayerChannel;
  operation: xdr.Operation;
  timeoutSeconds?: number;
  onSimulationError: (message: string) => Error;
  /** Relayer-source lane only: reuse a simulation taken earlier instead of simulating again. */
  presimulated?: rpc.Api.SimulateTransactionSuccessResponse;
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
  const { channel } = opts;
  const server = sorobanRpc();
  const passphrase = stellarPassphrase();
  const timeout = opts.timeoutSeconds ?? 180;

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
    const assembled = rpc.assembleTransaction(tx, sim).build();
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
  const assembled = rpc.assembleTransaction(authorized, sim2).build();
  assembled.sign(channel.keypair);
  return assembled;
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
    } catch {
      out.push({ index: i, address, funded: false, balanceXlm: null });
    }
  }
  return out;
}

const LOW_BALANCE_XLM = 5;
let healthCache: { at: number; value: { configured: number; funded: number } } | null = null;

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
  const balances = await relayerChannelBalances();
  const funded = balances.filter((b) => b.funded).length;
  for (const b of balances) {
    if (!b.funded) {
      log.warn({ channel: b.index, address: b.address }, "relayer channel is not funded");
    } else if (Number(b.balanceXlm) < LOW_BALANCE_XLM) {
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
