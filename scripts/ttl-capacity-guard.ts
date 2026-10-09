import type { env } from "@/lib/env";

/** Guard the opt-in rehearsal before connecting to or changing either service. */
export function assertTtlCapacityEnvironment(
  config: Pick<
    ReturnType<typeof env>,
    "NODE_ENV" | "STELLAR_NETWORK" | "DATABASE_URL" | "REDIS_URL"
  >,
): void {
  const database = new URL(config.DATABASE_URL);
  const redis = config.REDIS_URL ? new URL(config.REDIS_URL) : null;
  if (
    config.NODE_ENV !== "test" ||
    config.STELLAR_NETWORK !== "testnet" ||
    database.protocol !== "postgresql:" ||
    !["localhost", "127.0.0.1"].includes(database.hostname) ||
    database.port !== "55484" ||
    database.pathname !== "/ttl_capacity" ||
    database.search ||
    database.hash ||
    !redis ||
    redis.protocol !== "redis:" ||
    !["localhost", "127.0.0.1"].includes(redis.hostname) ||
    redis.port !== "56384" ||
    !["", "/0"].includes(redis.pathname) ||
    redis.search ||
    redis.hash
  ) {
    throw new Error(
      "TTL capacity rehearsal requires the dedicated local ttl_capacity database and Redis ports",
    );
  }
}
