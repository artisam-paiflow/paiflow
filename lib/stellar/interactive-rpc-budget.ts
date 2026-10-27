import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

export const INTERACTIVE_RPC_BUDGET_MS = 25_000;

type Budget = { readonly deadlineAt: number; readonly signal: AbortSignal };
// RPC clients survive Next development reloads, so their interceptors and new routes
// must see the same process-owned context. No request changes shared client defaults.
const processContext = globalThis as typeof globalThis & {
  interactiveRpcContext?: AsyncLocalStorage<Budget | undefined>;
};
const context = (processContext.interactiveRpcContext ??= new AsyncLocalStorage<
  Budget | undefined
>());

export class InteractiveRpcDeadlineError extends Error {
  readonly code = "RPC_DEADLINE";
  constructor() {
    super("Interactive RPC budget exhausted; check the original transaction hash if submitted");
    this.name = "InteractiveRpcDeadlineError";
  }
}

export const interactiveRpcBudget = () => context.getStore();
export function remainingInteractiveRpcMs(maximum = Infinity): number {
  const budget = context.getStore();
  return budget
    ? budget.signal.aborted
      ? 0
      : Math.max(0, Math.min(maximum, budget.deadlineAt - Date.now()))
    : maximum;
}
export const interactiveRpcBudgetExpired = () => remainingInteractiveRpcMs() <= 0;

async function ownedBudget<T>(work: () => Promise<T>, durationMs: number): Promise<T> {
  const controller = new AbortController();
  const budget = { deadlineAt: Date.now() + durationMs, signal: controller.signal };
  const timer = setTimeout(() => controller.abort(new InteractiveRpcDeadlineError()), durationMs);
  try {
    return await context.run(budget, work);
  } finally {
    clearTimeout(timer);
    // Close any HTTP work accidentally left behind by this operation. Durable bookkeeping
    // is not raced/cancelled: it still runs to completion before this finally is reached.
    controller.abort(new InteractiveRpcDeadlineError());
  }
}

/** One deadline for all interactive RPC calls, including nested helpers. */
export function withInteractiveRpcBudget<T>(
  work: () => Promise<T>,
  durationMs = INTERACTIVE_RPC_BUDGET_MS,
): Promise<T> {
  return context.getStore() ? work() : ownedBudget(work, durationMs);
}

/** Background shared event workers own their lifetime, capped by the initiating deadline.
 * A caller returning after its five-second wait must not abort a worker another caller joined.
 * Ordinary event reads/cron workers retain the existing ten-second per-RPC default.
 */
export function withIndependentEventRpcBudget<T>(work: () => Promise<T>): Promise<T> {
  return context.getStore() ? ownedBudget(work, remainingInteractiveRpcMs()) : work();
}

export function withoutInteractiveRpcBudget<T>(work: () => T): T {
  return context.run(undefined, work);
}
