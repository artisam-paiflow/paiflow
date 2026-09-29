import "server-only";
import { redis } from "./redis";
import { AppError } from "./errors";

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

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "0.0.0.0";
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
