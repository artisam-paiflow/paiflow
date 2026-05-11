import "server-only";
import Redis from "ioredis";
import { env } from "./env";

const globalForRedis = globalThis as unknown as {
  redis?: Redis | null;
  redisSub?: Redis | null;
};

function makeClient(): Redis | null {
  const url = env().REDIS_URL;
  if (!url) return null;
  const client = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
  });
  client.on("error", (err) => {
    // Avoid noisy stack traces in dev when Redis is intentionally offline.
    if (process.env.NODE_ENV === "development") return;
    console.error("[redis] error:", err.message);
  });
  return client;
}

export function redis(): Redis | null {
  if (globalForRedis.redis === undefined) {
    globalForRedis.redis = makeClient();
  }
  return globalForRedis.redis ?? null;
}

export function redisSub(): Redis | null {
  if (globalForRedis.redisSub === undefined) {
    globalForRedis.redisSub = makeClient();
  }
  return globalForRedis.redisSub ?? null;
}

export const eventChannel = (deploymentId: string) => `events:${deploymentId}`;
