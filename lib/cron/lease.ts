import "server-only";
import { randomUUID } from "node:crypto";
import { log } from "@/lib/log";
import { redis } from "@/lib/redis";

export type CronLeaseResult<T> = { acquired: true; value: T } | { acquired: false };

// Delete the key only if it still holds our id, so a run whose lease expired
// cannot release the lease of the run that replaced it.
const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

const RENEW_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;

const leaseKey = (name: string) => `cron:${name}`;

let warnedNoRedis = false;

/**
 * Run `fn` only if no other run of the cron `name` holds the lease, so a slow tick does not stack
 * on the next one. The lease is a Redis `SET NX PX` and lives at most `ttlMs`: pick a TTL above
 * the run's time budget plus the longest single item, since a lapsed lease lets the next tick
 * start alongside a run that is still going.
 *
 * Fails open. With no Redis configured, or when Redis errors, `fn` runs unguarded, exactly as
 * before this existed: skipping instead would stop every relayer cron whenever Redis blips. The
 * contracts' own due-date checks and the per-row claims remain the protection in that case. The
 * lease is also per Redis, so it does not coordinate runs that use different Redis instances.
 */
export async function withCronLease<T>(
  name: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<CronLeaseResult<T>> {
  const client = redis();
  if (!client) {
    if (!warnedNoRedis) {
      warnedNoRedis = true;
      log.warn({ cron: name }, "cron lease: Redis is not configured, running without a lease");
    }
    return { acquired: true, value: await fn() };
  }

  const key = leaseKey(name);
  const id = randomUUID();
  try {
    if ((await client.set(key, id, "PX", ttlMs, "NX")) !== "OK") return { acquired: false };
  } catch (err) {
    log.warn({ err, cron: name }, "cron lease: could not take the lease, running without one");
    return { acquired: true, value: await fn() };
  }

  // A run can outlast the TTL (one item may wait on the relayer lock and 30s of finality per
  // catch-up period), and a lapsed lease lets the next tick start alongside it. So the holder
  // keeps extending it while it lives; the TTL then only matters when the process dies.
  const renew = setInterval(
    () => {
      client.eval(RENEW_SCRIPT, 1, key, id, String(ttlMs)).catch((err: unknown) => {
        log.warn({ err, cron: name }, "cron lease: could not renew the lease");
      });
    },
    Math.max(1_000, Math.floor(ttlMs / 3)),
  );
  renew.unref();

  try {
    return { acquired: true, value: await fn() };
  } finally {
    clearInterval(renew);
    try {
      await client.eval(RELEASE_SCRIPT, 1, key, id);
    } catch (err) {
      // The TTL frees it.
      log.warn({ err, cron: name }, "cron lease: could not release the lease");
    }
  }
}

/** For tests: the next Redis-less run warns again. */
export function resetCronLeaseWarningForTests(): void {
  warnedNoRedis = false;
}
