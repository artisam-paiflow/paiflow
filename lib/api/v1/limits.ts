// Shared by the v1 routes and the OpenAPI document, so the limits a partner reads are the ones
// enforced. No server-only import: `lib/api/v1/openapi.ts` is imported by a script and by vitest.

/** Per token, per route. `openapi` and `demoToken` are the public routes, so they are keyed on the
 * caller's IP; `apiTokens` is the owner-session token routes, keyed on the signed-in user and shared
 * by all three. `demoTokenGlobal` is instance-wide: `clientIp()` is only as honest as the edge in
 * front (#433), so the per-IP cap alone is not a ceiling the route relies on. */
export const V1_RATE_LIMITS = {
  execute: { limit: 30, windowSeconds: 60 },
  payouts: { limit: 10, windowSeconds: 60 },
  payoutsSubmit: { limit: 30, windowSeconds: 60 },
  executeSubmit: { limit: 30, windowSeconds: 60 },
  releaseBefore: { limit: 10, windowSeconds: 60 },
  transactions: { limit: 60, windowSeconds: 60 },
  subscriptionState: { limit: 40, windowSeconds: 60 },
  balances: { limit: 30, windowSeconds: 60 },
  capabilities: { limit: 60, windowSeconds: 60 },
  events: { limit: 120, windowSeconds: 60 },
  openapi: { limit: 60, windowSeconds: 60 },
  apiTokens: { limit: 20, windowSeconds: 60 },
  demoToken: { limit: 3, windowSeconds: 3600 },
  demoTokenGlobal: { limit: 60, windowSeconds: 3600 },
} as const;

/**
 * The guards `v1Route` applies per client IP before the token is looked up (#524). Many honest
 * callers share an address — ten hackathon teams on one venue Wi-Fi is the case these are sized
 * for — so none may be a limit an honest room can reach by being busy. None applies to a token
 * this instance has minted or seen authenticate (`lib/api/v1/pre-auth.ts` has the full order).
 *
 * `ipBackstop` counts lookups of tokens not seen before, per address: the DB work a stream of
 * guessed tokens can drive. With Redis up, honest traffic barely touches it (each token is seen
 * once, at mint). It is sized for the case where it does: Redis down on more than one replica,
 * where "seen" is per process and a working token can look unseen to the replica it lands on. The
 * most one token can spend is events 120 + execute 30 + submit 30 = 180/min; ten teams each
 * running two tokens flat out (an app and a script, say) is 10 x 2 x 180 = 3,600/min, and ten teams
 * x three scripts polling `GET events` once a second is only 1,800/min, so 6,000/min leaves the
 * whole room better than 1.6x headroom over its own per-token ceilings.
 *
 * `failedAuth` counts refused authentications (no token, a malformed one, one the lookup rejects,
 * or one refused in the last minute) from the address. Every one is counted, and the first and
 * each multiple of `limit` are logged. 300 per 10 minutes is a bad-token retry every two seconds,
 * sustained; a person fixing a typo does not get near it. Past it, lookups of unseen tokens from
 * the address are held to `blockedLookups` (one a second) and the rest refused with 429. A script
 * looping on one bad token never spends that budget (a refused token is answered from memory for a
 * minute), so it is only a random-token flood that does; and only a real token never yet seen by
 * this instance, sent from that same address while the flood runs, can be caught behind it.
 */
export const V1_PRE_AUTH_LIMITS = {
  ipBackstop: { limit: 6_000, windowSeconds: 60 },
  failedAuth: { limit: 300, windowSeconds: 600 },
  blockedLookups: { limit: 60, windowSeconds: 60 },
} as const;

/**
 * How many `execute/submit?wait=true` calls one token may have waiting on the network at once.
 * A call over the cap still sends the transaction; it answers `PENDING` straight away, as
 * `wait=false` does, instead of holding the connection (#524). The slot's lease outlives the wait
 * so a process that dies mid-wait frees it by expiry rather than holding it forever: the longest a
 * live wait holds it is `CONFIRM_DEADLINE_MS` (25 s) plus one `getTransaction` that starts just
 * before the deadline and runs to `STELLAR_HTTP_TIMEOUT_MS` (10 s), about 35 s. Leases are scored
 * with each replica's clock; skew of seconds between replicas is inside that margin.
 */
export const V1_WAIT_SLOTS = {
  perToken: 3,
  leaseMs: 60_000,
} as const;
