// Shared by the v1 routes and the OpenAPI document, so the limits a partner reads are the ones
// enforced. No server-only import: `lib/api/v1/openapi.ts` is imported by a script and by vitest.

/** Per token, per route. `openapi` and `demoToken` are the public routes, so they are keyed on the
 * caller's IP; `apiTokens` is the owner-session token routes, keyed on the signed-in user and shared
 * by all three. `demoTokenGlobal` is instance-wide: `clientIp()` is only as honest as the edge in
 * front (#433), so the per-IP cap alone is not a ceiling the route relies on. */
export const V1_RATE_LIMITS = {
  execute: { limit: 30, windowSeconds: 60 },
  executeSubmit: { limit: 30, windowSeconds: 60 },
  events: { limit: 120, windowSeconds: 60 },
  openapi: { limit: 60, windowSeconds: 60 },
  apiTokens: { limit: 20, windowSeconds: 60 },
  demoToken: { limit: 3, windowSeconds: 3600 },
  demoTokenGlobal: { limit: 60, windowSeconds: 3600 },
} as const;

/**
 * The guards `v1Route` applies per client IP before the token is looked up (#524). Many honest
 * callers share an address — ten hackathon teams on one venue Wi-Fi is the case these are sized
 * for — so neither may be a limit an honest room can reach by being busy.
 *
 * `ipBackstop` counts every token-route request from the address, authenticated or not. It is a
 * ceiling on the DB lookups one address can drive, not a fairness limit; the per-token limits above
 * are that. The most one token can spend is events 120 + execute 30 + submit 30 = 180/min. Ten teams
 * each running two tokens flat out (an app and a script, say) is 10 x 2 x 180 = 3,600/min, and ten
 * teams x three scripts polling `GET events` once a second is only 1,800/min, so 6,000/min leaves
 * the whole room better than 1.6x headroom over its own per-token ceilings.
 *
 * `failedAuth` counts refused authentications (no token, a malformed one, or one the lookup
 * rejects) from the address. Past `limit` in the window, the address is blocked from further
 * *unauthenticated* attempts: a request whose token is not one Paiflow has minted or seen
 * authenticate recently is refused with 429 without touching the database. A valid token from the
 * same address is never affected (`lib/api/v1/pre-auth.ts`), so one team's script looping on a
 * revoked token costs the other nine teams nothing. 300 per 10 minutes is a bad-token retry every
 * two seconds, sustained; a person fixing a typo does not get near it.
 */
export const V1_PRE_AUTH_LIMITS = {
  ipBackstop: { limit: 6_000, windowSeconds: 60 },
  failedAuth: { limit: 300, windowSeconds: 600 },
} as const;

/**
 * How many `execute/submit?wait=true` calls one token may have waiting on the network at once.
 * A call over the cap still sends the transaction; it answers `PENDING` straight away, as
 * `wait=false` does, instead of holding the connection (#524). The slot's lease outlives the wait
 * so a process that dies mid-wait frees it by expiry rather than holding it forever.
 */
export const V1_WAIT_SLOTS = {
  perToken: 3,
  leaseMs: 60_000,
} as const;
