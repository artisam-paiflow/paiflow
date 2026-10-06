import { ENV_VAR_NAMES, env } from "@/lib/env";
import { assertTtlCapacityEnvironment } from "@/scripts/ttl-capacity-guard";

// Load Prisma's automatic .env handling before scrubbing, like the unit setup.
await import("@prisma/client");
const config = env();
assertTtlCapacityEnvironment(config);

for (const name of ENV_VAR_NAMES) delete process.env[name];
Object.assign(process.env, {
  NODE_ENV: "test",
  STELLAR_NETWORK: "testnet",
  DATABASE_URL: config.DATABASE_URL,
  REDIS_URL: config.REDIS_URL,
  AUTH_SECRET: "local-capacity-test-auth-secret-32-chars",
  LOG_LEVEL: "silent",
});
