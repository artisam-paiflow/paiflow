import "server-only";
import { randomUUID } from "node:crypto";
import { redis } from "@/lib/redis";
import { AppError } from "@/lib/errors";

export const PUBLIC_STREAM_LIFETIME_MS = 55_000;
export const PUBLIC_STREAM_LEASE_MS = 70_000;
export const PUBLIC_STREAM_CAPS = { total: 200, perIp: 40, perDeployment: 60 } as const;

// Atomic admission to all three shared caps. Dead processes lose their slots on
// lease expiry; streams close before expiry. Redis failure refuses SSE admission.
const ACQUIRE = `
for i, key in ipairs(KEYS) do
  redis.call('ZREMRANGEBYSCORE', key, '-inf', ARGV[1])
  if redis.call('ZCARD', key) >= tonumber(ARGV[i + 3]) then return 0 end
end
for _, key in ipairs(KEYS) do
  redis.call('ZADD', key, ARGV[2], ARGV[3])
  redis.call('PEXPIRE', key, tonumber(ARGV[2]) - tonumber(ARGV[1]))
end
return 1`;

export async function acquirePublicStreamSlot(ip: string, deploymentId: string) {
  const client = redis();
  if (!client) return null;
  const keys = [
    "public-embed:streams:total",
    `public-embed:streams:ip:${ip}`,
    `public-embed:streams:deployment:${deploymentId}`,
  ];
  const slot = randomUUID();
  const now = Date.now();
  let admitted: unknown;
  try {
    admitted = await client.eval(
      ACQUIRE,
      keys.length,
      ...keys,
      now,
      now + PUBLIC_STREAM_LEASE_MS,
      slot,
      PUBLIC_STREAM_CAPS.total,
      PUBLIC_STREAM_CAPS.perIp,
      PUBLIC_STREAM_CAPS.perDeployment,
    );
  } catch {
    return null;
  }
  if (admitted !== 1)
    throw new AppError("RATE_LIMITED", "Too many live viewers", undefined, undefined, 15);
  let released = false;
  return {
    client,
    release: async () => {
      if (released) return;
      released = true;
      await Promise.allSettled(keys.map((key) => client.zrem(key, slot)));
    },
  };
}
