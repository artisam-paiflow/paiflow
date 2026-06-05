// Vitest setup — ensure required env vars are present before any module
// that imports lib/env.ts (via relative paths) is loaded.
process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-auth-secret-at-least-32-chars-long";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://localhost:5432/pinkraft";
