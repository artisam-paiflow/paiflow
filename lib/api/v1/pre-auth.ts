import "server-only";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { noteLimiterFallback, peekRateLimit, rateLimit } from "@/lib/rate-limit";
import { redis } from "@/lib/redis";
import { refusedDeploymentToken } from "./auth";
import { V1_PRE_AUTH_LIMITS } from "./limits";

/**
 * The per-address guards `v1Route` runs before a deployment token is looked up (#524). Before
 * these, an unauthenticated caller had no bucket at all: every `Bearer pfk_…` cost a DB lookup with
 * nothing counted and nothing logged.
 *
 * Many honest callers share one address (a venue's Wi-Fi), so none of this may refuse a working
 * token because of what someone else on the address sent. The request is sorted first by what is
 * already known about its token, which costs no DB:
 *
 *  1. **Known**: minted (`markTokenKnown` in both mint routes) or authenticated within
 *     `KNOWN_TOKEN_TTL_SECONDS`. Skips every per-address guard; the per-token limits bound it.
 *     Known only means "worth a lookup": when the lookup refuses it, it is forgotten (2 or 3 next).
 *  2. **Recently refused** for this deployment: answered with the same generic 401, no lookup. A
 *     script looping on a revoked or mistyped token costs one lookup per `REFUSED_TOKEN_TTL_SECONDS`.
 *  3. **Neither**: a token this instance has not seen (a random guess, or a real token minted
 *     before this shipped and unused since). It gets a lookup, counted against the address's
 *     `ipBackstop`; and once the address has passed the failed-auth threshold, also against the
 *     much smaller `blockedLookups` budget. Only a random-token flood exhausts that budget, and
 *     only a never-yet-seen real token on the same address can be caught behind it.
 *
 * Every refusal is counted per address and logged (the first, then each multiple of the
 * threshold). Nothing here logs a token or its hash.
 *
 * Redis down: every store falls back to this process's memory and `noteLimiterFallback` logs it.
 * None fails closed: that would refuse every partner call, working tokens included, on a Redis
 * blip, where the per-process fallback still bounds each replica.
 */

/** How long a minted or authenticated token stays known without being used. */
export const KNOWN_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
/** How long a refused token is answered without a lookup. Short, so an owner reactivated after a
 * deactivation, the one refusal that can be undone, is not kept out for long. */
export const REFUSED_TOKEN_TTL_SECONDS = 60;
/** A known token's key is rewritten at most this often per process, not on every request. */
const KNOWN_REFRESH_MS = 60 * 60 * 1000;

// 128 bits of the stored SHA-256 is plenty to key on, and keeps the full column value out of Redis.
const short = (tokenHash: string) => tokenHash.slice(0, 32);
const knownKey = (tokenHash: string) => `v1:tok-known:${short(tokenHash)}`;
const refusedKey = (tokenHash: string, deploymentId: string) =>
  `v1:tok-refused:${short(tokenHash)}:${deploymentId}`;
const backstopKey = (ip: string) => `v1:ip:${ip}`;
const failedAuthKey = (ip: string) => `v1:authfail:${ip}`;
const blockedLookupsKey = (ip: string) => `v1:blocked-lookups:${ip}`;

export const BLOCKED_MESSAGE =
  "Too many failed authentication attempts from this address. Requests with a working token are " +
  "not affected; check the token you are sending.";

// ---- a TTL'd set in Redis, mirrored in this process ----

type Local = { until: number; writtenAt: number };
const LOCAL_CAP = 10_000;

function localSet(map: Map<string, Local>, key: string, ttlSeconds: number, now: number): void {
  if (map.size >= LOCAL_CAP) {
    for (const [k, v] of map) if (v.until <= now) map.delete(k);
    // Still full of live entries: drop the oldest (insertion order) rather than grow without bound.
    for (const k of map.keys()) {
      if (map.size < LOCAL_CAP) break;
      map.delete(k);
    }
  }
  map.delete(key);
  map.set(key, { until: now + ttlSeconds * 1000, writtenAt: now });
}

function localHas(map: Map<string, Local>, key: string, now: number): boolean {
  const v = map.get(key);
  return v !== undefined && v.until > now;
}

async function flagSet(
  map: Map<string, Local>,
  key: string,
  ttlSeconds: number,
  opts: { skipIfWrittenWithinMs?: number } = {},
): Promise<void> {
  const now = Date.now();
  const prev = map.get(key);
  if (
    opts.skipIfWrittenWithinMs &&
    prev &&
    prev.until > now &&
    now - prev.writtenAt < opts.skipIfWrittenWithinMs
  ) {
    return;
  }
  localSet(map, key, ttlSeconds, now);
  const client = redis();
  if (!client) {
    noteLimiterFallback("unconfigured");
    return;
  }
  try {
    await client.set(key, "1", "EX", ttlSeconds);
  } catch (err) {
    noteLimiterFallback("error", err);
  }
}

async function flagHas(map: Map<string, Local>, key: string): Promise<boolean> {
  if (localHas(map, key, Date.now())) return true;
  const client = redis();
  if (!client) {
    noteLimiterFallback("unconfigured");
    return false;
  }
  try {
    return (await client.exists(key)) === 1;
  } catch (err) {
    noteLimiterFallback("error", err);
    return false;
  }
}

async function flagDelete(map: Map<string, Local>, key: string): Promise<void> {
  map.delete(key);
  const client = redis();
  if (!client) return;
  try {
    await client.del(key);
  } catch (err) {
    noteLimiterFallback("error", err);
  }
}

const known = new Map<string, Local>();
const refused = new Map<string, Local>();

/**
 * Record that `tokenHash` is a real token, so no per-address guard refuses it. Best effort: it
 * never throws, and a failure only puts that token in the "neither" class until it next
 * authenticates.
 */
export async function markTokenKnown(tokenHash: string, expiresAt: Date | null): Promise<void> {
  let ttl = KNOWN_TOKEN_TTL_SECONDS;
  if (expiresAt) ttl = Math.min(ttl, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  if (ttl <= 0) return;
  await flagSet(known, knownKey(tokenHash), ttl, { skipIfWrittenWithinMs: KNOWN_REFRESH_MS });
}

// ---- the guards ----

/** Count a refused authentication from `ip`, logging the first one and each threshold multiple. */
async function countFailure(ip: string, route: string, reason: string): Promise<void> {
  const { limit, windowSeconds } = V1_PRE_AUTH_LIMITS.failedAuth;
  const r = await rateLimit(failedAuthKey(ip), limit, windowSeconds);
  const ctx = { ip, route, reason, failures: r.count, windowSeconds, shared: r.shared };
  if (r.count === 1) {
    log.info(ctx, "v1: authentication refused");
  } else if (r.count % limit === 0) {
    log.warn(
      ctx,
      r.count === limit
        ? "v1: failed-auth threshold reached; limiting lookups of unseen tokens from this address"
        : "v1: failed authentications from this address continue",
    );
  }
}

/** Called when the lookup refused the request's token: count it, and remember the refusal. */
export async function recordAuthFailure(
  ip: string,
  route: string,
  deploymentId: string,
  tokenHash: string | null,
): Promise<void> {
  if (tokenHash) {
    await Promise.all([
      flagDelete(known, knownKey(tokenHash)),
      flagSet(refused, refusedKey(tokenHash, deploymentId), REFUSED_TOKEN_TTL_SECONDS),
    ]);
  }
  await countFailure(ip, route, tokenHash ? "refused" : "no-token");
}

// One log line per address per window for the backstop, which a flood would otherwise turn into one
// line per request.
const backstopLogged = new Map<string, number>();

/**
 * Run before the token lookup. `tokenHash` is the hash of a well-formed bearer token, or null when
 * the request carries none (or a malformed one); those never reach the DB, so they are left to the
 * lookup to refuse and `recordAuthFailure` to count.
 */
export async function guardBeforeAuth(
  ip: string,
  route: string,
  deploymentId: string,
  tokenHash: string | null,
): Promise<void> {
  if (!tokenHash) return;
  if (await flagHas(known, knownKey(tokenHash))) return;

  if (await flagHas(refused, refusedKey(tokenHash, deploymentId))) {
    await countFailure(ip, route, "refused-recently");
    throw refusedDeploymentToken();
  }

  const { limit, windowSeconds } = V1_PRE_AUTH_LIMITS.ipBackstop;
  const backstop = await rateLimit(backstopKey(ip), limit, windowSeconds);
  if (!backstop.ok) {
    const now = Date.now();
    if ((backstopLogged.get(ip) ?? 0) <= now) {
      if (backstopLogged.size >= LOCAL_CAP) backstopLogged.clear();
      backstopLogged.set(ip, now + windowSeconds * 1000);
      log.warn(
        { ip, route, count: backstop.count, limit, windowSeconds, shared: backstop.shared },
        "v1: per-address backstop on unseen-token lookups reached",
      );
    }
    throw new AppError("RATE_LIMITED", "Too many requests from this address");
  }

  const failures = await peekRateLimit(failedAuthKey(ip));
  if (failures.count < V1_PRE_AUTH_LIMITS.failedAuth.limit) return;

  const budget = V1_PRE_AUTH_LIMITS.blockedLookups;
  const lookups = await rateLimit(blockedLookupsKey(ip), budget.limit, budget.windowSeconds);
  if (lookups.ok) return;
  await countFailure(ip, route, "blocked");
  throw new AppError("RATE_LIMITED", BLOCKED_MESSAGE);
}
