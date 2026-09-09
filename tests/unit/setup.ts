// Vitest setup — give every unit test the same environment.
//
// env() parses process.env through EnvSchema, so without this the suite reads
// whatever STELLAR_* / OFFRAMP_* variables happen to be in the developer's
// shell: a stray or malformed one fails test files that never mention it, and
// results differ between machines and CI. Clear everything the schema knows
// about, then put back the few a developer is meant to control.
//
// This runs once per test *file* — vitest re-executes setupFiles in each
// forked worker — and nothing re-scrubs between cases, so a test that mutates
// process.env cleans up after itself. Tests that need a specific value set it
// and call vi.resetModules() to clear env()'s memoized parse; see
// tests/unit/env.test.ts.
import { ENV_VAR_NAMES } from "@/lib/env";

// Read before the scrub. DATABASE_URL because streamer-jobs.test.ts and
// api/dev-splitter.test.ts run unscoped deleteMany() against the real Prisma
// client — hard-coding it aims those wipes at whatever the default names.
// LOG_LEVEL because lib/log.ts has no NODE_ENV=test special case, so this is
// the only way to quiet (or unquiet) pino for a run.
const passthrough = {
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://paiflow:paiflow@localhost:5432/paiflow",
  LOG_LEVEL: process.env.LOG_LEVEL ?? "silent",
};

for (const name of ENV_VAR_NAMES) delete process.env[name];

// Object.assign rather than a NODE_ENV member assignment: Next's types mark
// that one read-only.
Object.assign(process.env, passthrough, {
  AUTH_SECRET: "test-auth-secret-at-least-32-chars-long",
  // Pinned rather than exempted: vitest only does `NODE_ENV ??= "test"`, so a
  // shell `production` would survive and flip lib/prisma.ts and lib/redis.ts.
  NODE_ENV: "test",
});
