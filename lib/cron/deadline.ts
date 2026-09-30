/**
 * A wall-clock budget for one cron run. Checked at the top of each per-item loop, never mid-item:
 * stopping between a charge and the write that records it would leave the item half done.
 */
export type CronDeadline = { expired(): boolean; readonly budgetMs: number };

export function cronDeadline(budgetMs: number, now: () => number = Date.now): CronDeadline {
  const end = now() + budgetMs;
  return { budgetMs, expired: () => now() >= end };
}
