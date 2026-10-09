import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
export const requestHistoryContext = new AsyncLocalStorage<{ txHash: string | null }>();
/** Call only after envelope validation or an owner-scoped transaction lookup. */
export function linkApiTransaction(txHash: string) {
  const context = requestHistoryContext.getStore();
  if (context && /^[0-9a-f]{64}$/.test(txHash)) context.txHash = txHash;
}
