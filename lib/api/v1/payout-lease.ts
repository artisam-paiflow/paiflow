import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { redis } from "@/lib/redis";
import {
  payoutTransactionFinished,
  payoutTransactionStatus,
  type PayoutTransaction,
} from "@/lib/stellar/payout-state";

const TransactionSchema = z.object({
  txHash: z.string().regex(/^[a-f0-9]{64}$/),
  maxTime: z
    .string()
    .regex(/^\d+$/)
    .refine((s) => BigInt(s) > 0n),
});
const RecordSchema = z.object({
  owner: z.string().uuid(),
  deploymentId: z.string(),
  tokenId: z.string(),
  ownerExpires: z.number().int(),
  stage: z.enum(["preparing", "ready"]),
  configTx: TransactionSchema.optional(),
  deposit: TransactionSchema.optional(),
});
export type PayoutLeaseRecord = z.infer<typeof RecordSchema>;
const LEASE_MS = 45_000;
const keyFor = (id: string) => `v1:payout:${id}`;
const historyKey = (id: string, hash: string) => `v1:payout:${id}:tx:${hash}`;
const conflict = () =>
  new AppError(
    "CONFLICT",
    "Another payout is preparing or can still execute; submit its prepared envelope or retry after finality",
  );
const unavailable = () =>
  new AppError("UPSTREAM_RPC", "Payout coordination requires functioning Redis; try again");

function client() {
  const c = redis();
  if (!c || c.status !== "ready") throw unavailable();
  return c;
}
async function safely<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw unavailable();
  }
}
function decode(raw: string): PayoutLeaseRecord {
  try {
    return RecordSchema.parse(JSON.parse(raw));
  } catch {
    throw unavailable();
  }
}

// The record has NO Redis expiry. A crashed process leaves its transaction protection intact.
const REPLACE = `if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2]); return 1 end return 0`;
const PATCH = `local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end
local r=cjson.decode(raw); if r.owner~=ARGV[1] or r.ownerExpires<=tonumber(ARGV[2]) or r.stage~='preparing' then return 0 end
local p=cjson.decode(ARGV[3]); for k,v in pairs(p) do if v==cjson.null then r[k]=nil else r[k]=v end end
local out=cjson.encode(r); redis.call('SET',KEYS[1],out);
if r.stage=='ready' then redis.call('SET',KEYS[2],out,'EX',604800) end return 1`;
const RELEASE = `local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end
local r=cjson.decode(raw); if r.owner~=ARGV[1] then return 0 end
if ARGV[2]=='idle' and (r.stage~='preparing' or r.configTx) then return 0 end
redis.call('DEL',KEYS[1]); return 1`;

export async function acquirePayoutLease(deploymentId: string, tokenId: string) {
  const c = client();
  const key = keyFor(deploymentId);
  const record: PayoutLeaseRecord = {
    owner: randomUUID(),
    deploymentId,
    tokenId,
    stage: "preparing",
    ownerExpires: Date.now() + LEASE_MS,
  };
  const raw = await safely(() => c.get(key));
  if (raw) {
    const previous = decode(raw);
    if (previous.deploymentId !== deploymentId) throw unavailable();
    const tx = previous.deposit ?? previous.configTx;
    if (previous.stage === "preparing" && previous.ownerExpires > Date.now()) throw conflict();
    if (tx && !(await payoutTransactionFinished(tx))) throw conflict();
    if (previous.stage === "ready" && !previous.deposit) throw unavailable();
    if (Number(await safely(() => c.eval(REPLACE, 1, key, raw, JSON.stringify(record)))) !== 1)
      throw conflict();
  } else if ((await safely(() => c.set(key, JSON.stringify(record), "NX"))) !== "OK")
    throw conflict();

  let lost = false;
  async function patch(values: Record<string, unknown>, history = key) {
    if (lost) throw conflict();
    const ok = await safely(() =>
      c.eval(PATCH, 2, key, history, record.owner, Date.now(), JSON.stringify(values)),
    );
    if (Number(ok) !== 1) {
      lost = true;
      throw conflict();
    }
  }
  const heartbeat = setInterval(() => {
    void patch({ ownerExpires: Date.now() + LEASE_MS }).catch(() => {
      lost = true;
    });
  }, 10_000);
  heartbeat.unref();
  return {
    record,
    assertOwnership: () => patch({}),
    checkpointConfiguration: (tx: PayoutTransaction) =>
      patch({ configTx: TransactionSchema.parse(tx) }),
    configurationFinal: () => patch({ configTx: null }),
    ready: async (tx: PayoutTransaction) => {
      await patch(
        { stage: "ready", deposit: TransactionSchema.parse(tx) },
        historyKey(deploymentId, tx.txHash),
      );
    },
    assertReadyOwnership: async () => {
      const current = await safely(() => c.get(key));
      if (!current) throw conflict();
      const held = decode(current);
      if (held.owner !== record.owner || held.stage !== "ready") throw conflict();
    },
    close: async () => {
      clearInterval(heartbeat);
      await safely(() => c.eval(RELEASE, 1, key, record.owner, "idle"));
    },
  };
}

export async function assertPreparedPayout(
  deploymentId: string,
  tokenId: string,
  txHash: string,
): Promise<{ record: PayoutLeaseRecord; allowSubmit: boolean }> {
  const c = client();
  const history = await safely(() => c.get(historyKey(deploymentId, txHash)));
  if (!history)
    throw new AppError(
      "VALIDATION",
      "This transaction was not prepared by payouts for this token and deployment",
    );
  const record = decode(history);
  if (
    record.deploymentId !== deploymentId ||
    record.tokenId !== tokenId ||
    record.deposit?.txHash !== txHash
  )
    throw new AppError(
      "VALIDATION",
      "This transaction does not match this token's prepared payout",
    );
  const current = await safely(() => c.get(keyFor(deploymentId)));
  const owns = current !== null && decode(current).owner === record.owner;
  if (!current || decode(current).owner !== record.owner) {
    // A successor can only replace a ready record after finality or ledger-time expiry.
    const got = await payoutTransactionStatus(txHash);
    if (got.status !== "SUCCESS" && got.status !== "FAILED")
      throw new AppError("VALIDATION", "This prepared payout has expired; prepare a new payout");
  }
  return { record, allowSubmit: owns };
}

/** Compare owner tokens so an idempotent retry can never release a successor's protection. */
export async function releasePreparedPayout(record: PayoutLeaseRecord): Promise<void> {
  const c = client();
  await safely(() => c.eval(RELEASE, 1, keyFor(record.deploymentId), record.owner, "final"));
}
