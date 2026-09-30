/**
 * Per-cron lease TTL, time budget and batch size (#560). One module so a test can shrink them.
 *
 * The TTL must exceed the budget by at least the longest single item, because the budget is only
 * checked between items: a relayer charge waits for the global relayer lock and then up to 30s
 * for finality, and a deployment may catch up several periods. A lapsed lease lets the next tick
 * start while this run is still going (the holder also renews the lease while it runs).
 *
 * pollEvents' 20s budget is for an external scheduler that gives up at 30s (#486). It is checked
 * between deployments only, so a single slow deployment (several contracts, each `getEvents`
 * timing out at 10s) can still push one response past 30s; the lease and the run are unaffected.
 */
export const CRON_LIMITS = {
  pollEvents: { budgetMs: 20_000, ttlMs: 60_000, batch: 200 },
  autoChargePayroll: { budgetMs: 240_000, ttlMs: 600_000, batch: 100 },
  autoChargeSubscriptions: { budgetMs: 240_000, ttlMs: 600_000, batch: 100 },
  autoRelease: { budgetMs: 240_000, ttlMs: 600_000 },
} as const;
