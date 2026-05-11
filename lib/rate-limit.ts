import "server-only";
import { redis } from "./redis";

export type RateLimitResult = { ok: boolean; remaining: number; resetAt: number };

/**
 * Sliding-window-ish token bucket using Redis INCR with TTL.
 * Falls back to allow-all when Redis is unavailable (logged elsewhere);
 * auth routes wrap this in fail-closed logic.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const client = redis();
  if (!client) {
    return { ok: true, remaining: limit, resetAt: Date.now() + windowSeconds * 1000 };
  }
  const k = `rl:${key}`;
  try {
    const count = await client.incr(k);
    if (count === 1) {
      await client.expire(k, windowSeconds);
    }
    const ttl = await client.ttl(k);
    const resetAt = Date.now() + Math.max(ttl, 0) * 1000;
    return { ok: count <= limit, remaining: Math.max(0, limit - count), resetAt };
  } catch {
    return { ok: true, remaining: limit, resetAt: Date.now() + windowSeconds * 1000 };
  }
}

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "0.0.0.0";
}
