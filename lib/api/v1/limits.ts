// Shared by the v1 routes and the OpenAPI document, so the limits a partner reads are the ones
// enforced. No server-only import: `lib/api/v1/openapi.ts` is imported by a script and by vitest.

/** Per token, per route. `openapi` and `demoToken` are the public routes, so they are keyed on the
 * caller's IP; `apiTokens` is the owner-session token routes, keyed on the signed-in user and shared
 * by all three. `demoTokenGlobal` is instance-wide: `clientIp()` trusts the first X-Forwarded-For
 * hop, so the per-IP cap alone cannot bound an anonymous caller who sets that header. */
export const V1_RATE_LIMITS = {
  execute: { limit: 30, windowSeconds: 60 },
  executeSubmit: { limit: 30, windowSeconds: 60 },
  events: { limit: 120, windowSeconds: 60 },
  openapi: { limit: 60, windowSeconds: 60 },
  apiTokens: { limit: 20, windowSeconds: 60 },
  demoToken: { limit: 3, windowSeconds: 3600 },
  demoTokenGlobal: { limit: 60, windowSeconds: 3600 },
} as const;
