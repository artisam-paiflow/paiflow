import "server-only";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { noteLimiterFallback, peekRateLimit, rateLimit } from "@/lib/rate-limit";
import { redis } from "@/lib/redis";
import { V1_PRE_AUTH_LIMITS } from "./limits";

/**
 * The per-IP guards `v1Route` runs before a deployment token is looked up (#524). Before these, an
 * unauthenticated caller had no bucket at all: every `Bearer pfk_…` cost a DB lookup with nothing
 * counted and nothing logged.
 *
 * Many honest callers share one address (a venue's Wi-Fi), so the design is that no address-wide
 * state ever refuses a request carrying a valid token:
 *
 *  - `ipBackstop` is sized far above what a room of honest callers can reach under their per-token
 *    limits (the arithmetic is on `V1_PRE_AUTH_LIMITS`).
 *  - The failed-auth block refuses, without a DB lookup, only requests whose token is not *known*.
 *    A token is known from the moment it is minted (`markTokenKnown` in both mint routes) and each
 *    time it authenticates, for `KNOWN_TOKEN_TTL_SECONDS` or the token's own life if shorter. Known
 *    only means "worth a lookup": a known token that has since been revoked still gets its lookup,
 *    its 401, and a count.
 *
 * Redis down: all three stores fall back to this process's memory and `noteLimiterFallback` logs
 * it. None fails closed. Failing closed here would refuse every partner call, valid tokens
 * included, on a Redis blip; the per-process fallback still bounds each replica.
 */

/** How long a minted or authenticated token stays known without being used. */
export const KNOWN_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

const backstopKey = (ip: string) => `v1:ip:${ip}`;
const failedAuthKey = (ip: string) => `v1:authfail:${ip}`;
// 128 bits of the stored SHA-256 is plenty to key on, and keeps the full column value out of Redis.
const knownKey = (tokenHash: string) => `v1:tok-known:${tokenHash.slice(0, 32)}`;

const localKnown = new Map<string, number>();
const LOCAL_KNOWN_PRUNE_AT = 10_000;

// One log line per address per window for the backstop, which a flood would otherwise turn into one
// line per request.
const backstopLogged = new Map<string, number>();

export const BLOCKED_MESSAGE =
  "Too many failed authentication attempts from this address. Requests with a valid token are " +
  "not affected; check the token you are sending.";

function knownTtlSeconds(expiresAt: Date | null, now: number): number {
  if (!expiresAt) return KNOWN_TOKEN_TTL_SECONDS;
  return Math.min(KNOWN_TOKEN_TTL_SECONDS, Math.floor((expiresAt.getTime() - now) / 1000));
}

function rememberLocally(key: string, ttlSeconds: number, now: number): void {
  if (localKnown.size >= LOCAL_KNOWN_PRUNE_AT) {
    for (const [k, until] of localKnown) if (until <= now) localKnown.delete(k);
  }
  localKnown.set(key, now + ttlSeconds * 1000);
}

/**
 * Record that `tokenHash` is a real token, so a failed-auth block on some address never refuses
 * it. Best effort: it never throws, and a failure only means that token gets no exemption from a
 * block until it next authenticates somewhere unblocked.
 */
export async function markTokenKnown(tokenHash: string, expiresAt: Date | null): Promise<void> {
  const now = Date.now();
  const ttl = knownTtlSeconds(expiresAt, now);
  if (ttl <= 0) return;
  const key = knownKey(tokenHash);
  // Always kept locally too, so a Redis outage that starts later does not forget it in this process.
  rememberLocally(key, ttl, now);
  const client = redis();
  if (!client) {
    noteLimiterFallback("unconfigured");
    return;
  }
  try {
    await client.set(key, "1", "EX", ttl);
  } catch (err) {
    noteLimiterFallback("error", err);
  }
}

async function isTokenKnown(tokenHash: string): Promise<boolean> {
  const key = knownKey(tokenHash);
  const until = localKnown.get(key);
  if (until !== undefined && until > Date.now()) return true;
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

/** Count a refused authentication from `ip`, logging the first one and each threshold multiple. */
export async function recordAuthFailure(
  ip: string,
  route: string,
  reason: "refused" | "blocked",
): Promise<void> {
  const { limit, windowSeconds } = V1_PRE_AUTH_LIMITS.failedAuth;
  const r = await rateLimit(failedAuthKey(ip), limit, windowSeconds);
  const ctx = { ip, route, reason, failures: r.count, windowSeconds, shared: r.shared };
  if (r.count === 1) {
    log.info(ctx, "v1: authentication refused");
  } else if (r.count % limit === 0) {
    log.warn(
      ctx,
      r.count === limit
        ? "v1: failed-auth threshold reached; refusing unknown tokens from this address"
        : "v1: failed authentications from this address continue",
    );
  }
}

/**
 * Run before the token lookup. `tokenHash` is the hash of a well-formed bearer token, or null when
 * the request carries none (or a malformed one), which can never authenticate.
 */
export async function guardBeforeAuth(
  ip: string,
  route: string,
  tokenHash: string | null,
): Promise<void> {
  const { limit, windowSeconds } = V1_PRE_AUTH_LIMITS.ipBackstop;
  const backstop = await rateLimit(backstopKey(ip), limit, windowSeconds);
  if (!backstop.ok) {
    const now = Date.now();
    if ((backstopLogged.get(ip) ?? 0) <= now) {
      if (backstopLogged.size >= LOCAL_KNOWN_PRUNE_AT) backstopLogged.clear();
      backstopLogged.set(
        ip,
        backstop.resetAt > now ? backstop.resetAt : now + windowSeconds * 1000,
      );
      log.warn(
        { ip, route, count: backstop.count, limit, windowSeconds, shared: backstop.shared },
        "v1: per-address backstop reached",
      );
    }
    throw new AppError("RATE_LIMITED", "Too many requests from this address");
  }

  const failures = await peekRateLimit(failedAuthKey(ip));
  if (failures.count < V1_PRE_AUTH_LIMITS.failedAuth.limit) return;
  if (tokenHash && (await isTokenKnown(tokenHash))) return;

  await recordAuthFailure(ip, route, "blocked");
  throw new AppError("RATE_LIMITED", BLOCKED_MESSAGE);
}
