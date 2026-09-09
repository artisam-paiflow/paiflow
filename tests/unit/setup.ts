// Vitest setup — give every unit test the same environment.
//
// env() parses process.env through EnvSchema, so without this the suite reads
// whatever STELLAR_* / OFFRAMP_* variables happen to be in the developer's
// shell: a stray or malformed one fails test files that never mention it, and
// results differ between machines and CI. Clear everything the schema knows
// about (NODE_ENV excepted — vitest owns it), then set the only two vars that
// have no default and let the schema supply the rest.
//
// Tests that need a specific value set it themselves and call
// vi.resetModules() to clear env()'s memoized parse; see tests/unit/env.test.ts.
import { ENV_VAR_NAMES } from "@/lib/env";

for (const name of ENV_VAR_NAMES) {
  if (name === "NODE_ENV") continue;
  delete process.env[name];
}

process.env.AUTH_SECRET = "test-auth-secret-at-least-32-chars-long";
process.env.DATABASE_URL = "postgresql://paiflow:paiflow@localhost:5432/paiflow";
