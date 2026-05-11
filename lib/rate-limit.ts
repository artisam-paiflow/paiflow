import "server-only";
import { redis } from "./redis";
import { AppError } from "./errors";

export type RateLimitResult = { ok: boolean; remaining: number; resetAt: number };

const memBuckets = new Map<string, { count: number; resetAt: number }>();

function memRateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const bucket = memBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    const resetAt = now + windowSeconds * 1000;
    memBuckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: limit - 1, resetAt };
  }
  bucket.count += 1;
  return {
    ok: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
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
    return { ok: count <= limit, remaining: Math.max(0, limit - count), resetAt };
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
