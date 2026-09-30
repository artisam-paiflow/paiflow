/**
 * Per-cron lease TTL, time budget and batch size (#560). One module so a test can shrink them.
 *
 * The TTL must exceed the budget by at least the longest single item, because the budget is only
 * checked between items: a relayer charge waits for the global relayer lock and then up to 30s
 * for finality, and a deployment may catch up several periods. A lapsed lease lets the next tick
 * start while this run is still going.
 */
export const CRON_LIMITS = {
  pollEvents: { budgetMs: 50_000, ttlMs: 150_000, batch: 200 },
  autoChargePayroll: { budgetMs: 240_000, ttlMs: 600_000, batch: 100 },
  autoChargeSubscriptions: { budgetMs: 240_000, ttlMs: 600_000, batch: 100 },
  autoRelease: { budgetMs: 240_000, ttlMs: 600_000 },
} as const;
