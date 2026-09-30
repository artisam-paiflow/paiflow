import "server-only";
import { redis } from "./redis";
import { AppError } from "./errors";
import { env } from "./env";
import { log } from "./log";

/**
 * `shared` is true only when the count came from Redis, i.e. when the bucket is
 * genuinely instance-wide. A caller whose limit is a security control rather
 * than a courtesy (see app/api/auth/sandbox/route.ts) can refuse the request
 * when it is false instead of trusting a per-process fallback.
 */
export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  /** Requests counted in this window, this one included. */
  count: number;
  resetAt: number;
  shared: boolean;
};

const memBuckets = new Map<string, { count: number; resetAt: number }>();
// Per-IP keys (the v1 pre-auth buckets among them) would otherwise grow the map
// for as long as the process runs on the fallback.
const MEM_BUCKETS_PRUNE_AT = 10_000;
// Past this even after pruning, the oldest live buckets go: forgetting a few counts is better
// than a process that grows until it dies.
const MEM_BUCKETS_MAX = 50_000;

function pruneMemBuckets(now: number): void {
  if (memBuckets.size < MEM_BUCKETS_PRUNE_AT) return;
  for (const [k, b] of memBuckets) if (b.resetAt < now) memBuckets.delete(k);
  for (const k of memBuckets.keys()) {
    if (memBuckets.size < MEM_BUCKETS_MAX) break;
    memBuckets.delete(k);
  }
}

function memPeek(key: string): number {
  const bucket = memBuckets.get(key);
  return bucket && bucket.resetAt >= Date.now() ? bucket.count : 0;
}

/** At most one fallback warning per this long, carrying how many it stands for. */
export const FALLBACK_WARN_INTERVAL_MS = 60_000;
const fallbackWarn = { lastAt: 0, suppressed: 0 };

/**
 * Say, loudly but not once per request, that a count just came from this
 * process's memory instead of Redis (#524). Without shared Redis every limit is
 * per replica, so N replicas allow N times the limit; that used to happen with
 * nothing in the logs. An unset `REDIS_URL` outside production is the expected
 * local setup and stays quiet. Also used by the other Redis-backed guards that
 * fall back to memory (`lib/api/v1/pre-auth.ts`, `lib/api/v1/wait-slots.ts`).
 */
export function noteLimiterFallback(reason: "unconfigured" | "error", err?: unknown): void {
  if (reason === "unconfigured" && env().NODE_ENV !== "production") return;
  const now = Date.now();
  if (now - fallbackWarn.lastAt < FALLBACK_WARN_INTERVAL_MS) {
    fallbackWarn.suppressed += 1;
    return;
  }
  const suppressed = fallbackWarn.suppressed;
  fallbackWarn.lastAt = now;
  fallbackWarn.suppressed = 0;
  log.warn(
    { reason, err, suppressedSinceLastWarning: suppressed },
    "rate limit: no shared Redis, counting in this process only",
  );
}

/** Test hook: forget when the last fallback warning was logged. */
export function resetLimiterFallbackWarning(): void {
  fallbackWarn.lastAt = 0;
  fallbackWarn.suppressed = 0;
}

function memRateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const bucket = memBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    pruneMemBuckets(now);
    const resetAt = now + windowSeconds * 1000;
    memBuckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: limit - 1, count: 1, resetAt, shared: false };
  }
  bucket.count += 1;
  return {
    ok: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    count: bucket.count,
    resetAt: bucket.resetAt,
    shared: false,
  };
}

/**
 * Fixed-window counter using Redis INCR with TTL.
 *
 * Falls back to an in-memory bucket when Redis is unavailable, so every limit
 * still holds within one process, and logs that it did (`noteLimiterFallback`).
 * Whether to refuse instead is the caller's decision, made on `shared`: the
 * sandbox and demo-token mints do, because their instance-wide caps are the
 * only bound on rows an anonymous caller creates. Everything else, `/api/v1`
 * included, keeps serving on the per-process count rather than taking every
 * caller down on a Redis blip (#524).
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const client = redis();
  if (!client) {
    noteLimiterFallback("unconfigured");
    return memRateLimit(key, limit, windowSeconds);
  }
  const k = `rl:${key}`;
  try {
    const count = await client.incr(k);
    if (count === 1) await client.expire(k, windowSeconds);
    let ttl = await client.ttl(k);
    // -1 is a key with no expiry: the EXPIRE after the first INCR failed or never ran (a crash
    // between the two). Left alone, that bucket would never reset and its caller would be refused
    // for good, so any later call repairs it.
    if (ttl === -1) {
      await client.expire(k, windowSeconds);
      ttl = windowSeconds;
    }
    const resetAt = Date.now() + Math.max(ttl, 0) * 1000;
    return {
      ok: count <= limit,
      remaining: Math.max(0, limit - count),
      count,
      resetAt,
      shared: true,
    };
  } catch (err) {
    noteLimiterFallback("error", err);
    return memRateLimit(key, limit, windowSeconds);
  }
}

/**
 * The current count of a `rateLimit` bucket without adding to it: 0 when it is
 * empty or its window has lapsed. Reads the store `rateLimit` would write, and
 * falls back to memory the same way.
 */
export async function peekRateLimit(key: string): Promise<{ count: number; shared: boolean }> {
  const client = redis();
  if (!client) {
    noteLimiterFallback("unconfigured");
    return { count: memPeek(key), shared: false };
  }
  try {
    const raw = await client.get(`rl:${key}`);
    const count = raw === null ? 0 : Number.parseInt(raw, 10);
    return { count: Number.isFinite(count) ? count : 0, shared: true };
  } catch (err) {
    noteLimiterFallback("error", err);
    return { count: memPeek(key), shared: false };
  }
}

export async function enforceRateLimit(opts: {
  key: string;
  limit: number;
  windowSeconds: number;
  message?: string;
}): Promise<void> {
  const r = await rateLimit(opts.key, opts.limit, opts.windowSeconds);
  if (!r.ok) {
    throw new AppError("RATE_LIMITED", opts.message ?? "Too many requests");
  }
}

/** What `clientIp()` returns when no usable address was presented. One shared bucket. */
export const UNKNOWN_CLIENT_IP = "0.0.0.0";

/**
 * The caller's address, for per-IP rate-limit keys, `AuditLog.ip` and the
 * `/ingest` proxy. Only as honest as the edge in front of the app (#433).
 *
 * Which `X-Forwarded-For` entry to believe is `TRUSTED_PROXY_HOPS`:
 *
 *  - 0 (default): the leftmost entry. Correct only behind an edge that replaces
 *    the header rather than appending to it. Railway's does: on staging (19 Sep
 *    2026, `server: railway-hikari`, no CDN) a client-sent `X-Forwarded-For:
 *    198.51.100.77, 198.51.100.78` reached the app with the caller's real
 *    address as the first entry (issue #433). That is observed, not documented;
 *    Railway documents only `X-Real-IP`.
 *  - N >= 1: the Nth entry from the right, for N proxies that each append the
 *    peer they saw. Set it before putting a pass-through proxy (a CDN, a load
 *    balancer) in front, or the leftmost entry becomes whatever the client sent.
 *    A chain shorter than N, or no header at all, did not come through those
 *    proxies (a direct hit on the origin), so nothing in it is trusted: the
 *    caller gets the shared unknown bucket, and `X-Real-IP` is not consulted.
 *
 * Rightmost-minus-hops is not the default because Railway's header length is
 * unobserved: the probe only saw its first entry, and if the edge ever sends
 * `client, internal-hop` then hops=1 would put every caller in one bucket.
 *
 * With hops=0, `X-Real-IP` is read only when `X-Forwarded-For` is absent or
 * empty, which never happens behind Railway. It is not preferred: whether the
 * edge overwrites a client-supplied `X-Real-IP` is untested.
 *
 * Every value is normalised by `normalizeIp()` so a hostile header cannot mint
 * arbitrary rate-limit keys or write junk into the audit log.
 */
export function clientIp(req: Request): string {
  const hops = env().TRUSTED_PROXY_HOPS ?? 0;
  const xff = req.headers.get("x-forwarded-for")?.trim();
  if (hops > 0) {
    const entries = xff ? xff.split(",") : [];
    if (entries.length < hops) return UNKNOWN_CLIENT_IP;
    return normalizeIp(entries[entries.length - hops]) ?? UNKNOWN_CLIENT_IP;
  }
  if (xff) return normalizeIp(xff.split(",")[0]) ?? UNKNOWN_CLIENT_IP;
  return normalizeIp(req.headers.get("x-real-ip")) ?? UNKNOWN_CLIENT_IP;
}

// 45 chars is the longest textual IPv6 (IPv4-mapped); the slack covers brackets and a port.
const MAX_IP_TEXT_LENGTH = 64;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;
const BRACKETED_IPV6 = /^\[([^\]]+)\](?::\d{1,5})?$/;
const IPV4_MAPPED = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

function canonicalIpv4(s: string): string | null {
  const m = IPV4.exec(s);
  if (!m) return null;
  const octets = m.slice(1);
  // "010" would be a second key for the same host; refuse rather than guess octal or decimal.
  if (octets.some((o) => (o.length > 1 && o.startsWith("0")) || Number(o) > 255)) return null;
  return octets.join(".");
}

/**
 * One address, in one canonical spelling, or null. Trims, drops a port, IPv6
 * brackets and a zone id, lower-cases and compresses IPv6 (via the WHATWG URL
 * parser, which runs on every runtime), and unwraps IPv4-mapped IPv6 so
 * `::ffff:1.2.3.4` and `1.2.3.4` share a bucket. Anything else is null.
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (s.length === 0 || s.length > MAX_IP_TEXT_LENGTH) return null;

  const bracketed = BRACKETED_IPV6.exec(s);
  if (bracketed) s = bracketed[1]!;
  else {
    const withPort = IPV4_WITH_PORT.exec(s);
    if (withPort) s = withPort[1]!;
  }

  const v4 = canonicalIpv4(s);
  if (v4) return v4;
  if (!s.includes(":")) return null;

  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  if (!/^[0-9a-fA-F:.]+$/.test(s)) return null;

  let host: string;
  try {
    host = new URL(`http://[${s}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
  const mapped = IPV4_MAPPED.exec(host);
  if (mapped) {
    const hi = parseInt(mapped[1]!, 16);
    const lo = parseInt(mapped[2]!, 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return host;
}

/**
 * Who a per-caller bucket belongs to: the signed-in user, or the address when
 * there is no session. Many honest people share one address (a venue's Wi-Fi,
 * a carrier's CGNAT), so a limit meant to be fair between callers keys on the
 * user whenever there is one, and keeps an IP-wide bucket only as a much
 * looser backstop (#725).
 */
export function rateLimitSubject(user: { id: string } | null, ip: string): string {
  return user ? `user:${user.id}` : `ip:${ip}`;
}

/**
 * Limits for the deployment page's background reads, shared by the routes and
 * their tests. `perCaller` is keyed on deployment + user; `ipBackstop` on the
 * address alone, sized so ten hackathon teams on one Wi-Fi fit under it:
 * ~10 teams x 4 people x 2 open deployment tabs = 80 tabs.
 *
 *  - balances: `live-balances.tsx` polls every 10 s, 6/min per tab. 60 per
 *    caller covers ten tabs of one deployment; 80 tabs x 6 = 480, so 600/min.
 *  - poll-events: called on page load and each SSE reconnect, and does Soroban
 *    RPC work per call. 30 per caller as before; 300/min is ~4 loads or
 *    reconnects per minute for each of those 80 tabs.
 *  - wallet-connect: one call per wallet connection. 30 per caller as before;
 *    300/min for the room.
 */
export const CALLER_RATE_LIMITS = {
  balances: {
    perCaller: { limit: 60, windowSeconds: 60 },
    ipBackstop: { limit: 600, windowSeconds: 60 },
  },
  pollEvents: {
    perCaller: { limit: 30, windowSeconds: 60 },
    ipBackstop: { limit: 300, windowSeconds: 60 },
  },
  walletConnect: {
    perCaller: { limit: 30, windowSeconds: 60 },
    ipBackstop: { limit: 300, windowSeconds: 60 },
  },
} as const;
