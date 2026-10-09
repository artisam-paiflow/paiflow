import "server-only";
import crypto from "node:crypto";
import { noteLimiterFallback } from "@/lib/rate-limit";
import { redis } from "@/lib/redis";
import { V1_WAIT_SLOTS } from "./limits";

/**
 * A counting semaphore over `execute/submit?wait=true`, per token (#524). Without it one token could
 * hold its whole per-minute submit allowance open as 25-second requests, each polling RPC every
 * 1.5 s.
 *
 * In Redis, a sorted set per token whose members are slot ids scored by their lease expiry. Acquire
 * is one MULTI: drop expired members, add ours, count. Over the cap, ours is removed again. Two
 * racing acquirers can both see the other's member and both give up, never both succeed past the
 * cap, so the race errs toward degrading a wait rather than exceeding the cap. The lease is what
 * frees the slot of a process that died mid-wait, and the key's own TTL removes an idle set.
 *
 * Without Redis (or on a Redis error) the slots are counted in this process, per replica, and
 * `noteLimiterFallback` logs it. Failing closed would only turn a wait into an immediate `PENDING`,
 * which is exactly the degraded answer anyway, so the fallback is here to keep `wait=true` working,
 * not for safety.
 */

export type WaitSlot = { release: () => Promise<void> };

const slotKey = (tokenId: string) => `v1:wait-slots:${tokenId}`;

const local = new Map<string, Map<string, number>>();

function acquireLocally(tokenId: string, id: string, now: number): WaitSlot | null {
  let slots = local.get(tokenId);
  if (!slots) {
    slots = new Map();
    local.set(tokenId, slots);
  }
  for (const [slot, until] of slots) if (until <= now) slots.delete(slot);
  if (slots.size >= V1_WAIT_SLOTS.perToken) return null;
  slots.set(id, now + V1_WAIT_SLOTS.leaseMs);
  const held = slots;
  return {
    release: async () => {
      held.delete(id);
      if (held.size === 0 && local.get(tokenId) === held) local.delete(tokenId);
    },
  };
}

/**
 * Take one of the token's wait slots, or null when all are held. The caller must `release()` the
 * slot in a `finally`; release never throws.
 */
export async function acquireWaitSlot(tokenId: string): Promise<WaitSlot | null> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const client = redis();
  if (!client) {
    noteLimiterFallback("unconfigured");
    return acquireLocally(tokenId, id, now);
  }
  const key = slotKey(tokenId);
  try {
    const results = await client
      .multi()
      .zremrangebyscore(key, "-inf", now)
      .zadd(key, now + V1_WAIT_SLOTS.leaseMs, id)
      .zcard(key)
      .pexpire(key, V1_WAIT_SLOTS.leaseMs)
      .exec();
    const card = results?.[2];
    if (!card || card[0] || typeof card[1] !== "number") throw new Error("wait slot: bad reply");
    if (card[1] > V1_WAIT_SLOTS.perToken) {
      await client.zrem(key, id).catch(() => undefined);
      return null;
    }
  } catch (err) {
    noteLimiterFallback("error", err);
    return acquireLocally(tokenId, id, now);
  }
  return {
    release: async () => {
      // A failed release is not a leak: the member's lease expires on its own.
      await client.zrem(key, id).catch(() => undefined);
    },
  };
}
