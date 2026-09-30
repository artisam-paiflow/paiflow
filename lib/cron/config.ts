/**
 * Per-cron lease TTL, time budget and batch size (#560). One module so a test can shrink them.
 *
 * The TTL must exceed the budget by at least the longest single item, because the budget is only
 * checked between items: a relayer charge waits for the global relayer lock and then up to 30s
 * for finality, and a deployment may catch up several periods. A lapsed lease lets the next tick
 * start while this run is still going (the holder also renews the lease while it runs).
 *
 * Every budget is 20s because all four crons are called each minute by cron-job.org, which gives
 * up at 30s (#486) and stops calling after a run of failures. The budget is checked between items
 * only, so one slow item (a relayer charge waiting on the lock and finality, or a deployment whose
 * `getEvents` calls each time out at 10s) can still push a response past 30s; the run finishes
 * server-side and the next tick picks up the rest.
 *
 * poll-events polls `concurrency` deployments at once (#486). Each poll is a chain of sequential
 * `getEvents` calls (~0.7s per deployment), so 6 workers cover roughly 35 deployments per 5s and
 * about 8 to 10 RPC requests a second against a shared, rate-limited endpoint. Raise it only after
 * checking the provider's limits. No poll takes the relayer lock.
 */
export const CRON_LIMITS = {
  pollEvents: { budgetMs: 20_000, ttlMs: 60_000, batch: 200, concurrency: 6 },
  autoChargePayroll: { budgetMs: 20_000, ttlMs: 600_000, batch: 100 },
  autoChargeSubscriptions: { budgetMs: 20_000, ttlMs: 600_000, batch: 100 },
  autoRelease: { budgetMs: 20_000, ttlMs: 600_000 },
} as const;
