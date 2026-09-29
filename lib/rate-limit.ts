import "server-only";
import { redis } from "./redis";
import { AppError } from "./errors";
import { env } from "./env";

/**
 * `shared` is true only when the count came from Redis, i.e. when the bucket is
 * genuinely instance-wide. A caller whose limit is a security control rather
 * than a courtesy (see app/api/auth/sandbox/route.ts) can refuse the request
 * when it is false instead of trusting a per-process fallback.
 */
export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: number;
  shared: boolean;
};

const memBuckets = new Map<string, { count: number; resetAt: number }>();

function memRateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const bucket = memBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    const resetAt = now + windowSeconds * 1000;
    memBuckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: limit - 1, resetAt, shared: false };
  }
  bucket.count += 1;
  return {
    ok: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
    shared: false,
  };
}

/**
 * Sliding-window-ish token bucket using Redis INCR with TTL.
 * Falls back to an in-memory bucket when Redis is unavailable so the auth
 * routes are still protected within a single instance.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const client = redis();
  if (!client) return memRateLimit(key, limit, windowSeconds);
  const k = `rl:${key}`;
  try {
    const count = await client.incr(k);
    if (count === 1) await client.expire(k, windowSeconds);
    const ttl = await client.ttl(k);
    const resetAt = Date.now() + Math.max(ttl, 0) * 1000;
    return { ok: count <= limit, remaining: Math.max(0, limit - count), resetAt, shared: true };
  } catch {
    return memRateLimit(key, limit, windowSeconds);
  }
}

export async function enforceRateLimit(opts: {
  key: string;
  limit: number;
  windowSeconds: number;
  failOpenOnRedisError?: boolean;
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
