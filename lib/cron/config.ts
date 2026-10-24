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
 * poll-events polls `concurrency` deployments at once (#486). Each poll scans sequential
 * groups of at most five contract IDs, with five pages of allowance per requested contract
 * (at most 25 pages per group, preserving the former total request budget). This keeps at most
 * six event RPC requests in flight in this cron; batching reduces calls for quiet pipelines.
 * Request rate still depends on latency, pagination and competing callers. Raise concurrency
 * only after checking the provider's limits. No poll takes the relayer lock.
 */
export const CRON_LIMITS = {
  reconcileTransactions: { budgetMs: 12_000, ttlMs: 60_000, batch: 50 },
  reconcileServiceTransactions: { budgetMs: 4_000, batch: 50 },
  analyticsDelivery: { budgetMs: 6_000, batch: 20 },
  pollEvents: { budgetMs: 20_000, ttlMs: 60_000, batch: 200, concurrency: 6 },
  autoChargePayroll: { budgetMs: 20_000, ttlMs: 600_000, batch: 100 },
  autoChargeSubscriptions: { budgetMs: 20_000, ttlMs: 600_000, batch: 100 },
  autoRelease: { budgetMs: 20_000, ttlMs: 600_000 },
} as const;
