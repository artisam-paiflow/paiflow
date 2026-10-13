/** Only a hash and read-only status receipt persist; never a signed envelope. */
export type PendingTrigger = { txHash: string; receipt?: string };
export const triggerPendingKey = (id: string, network: string) =>
  `paiflow_trigger_pending:${id}:${network}`;
export function readPendingTrigger(key: string): PendingTrigger | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const value = JSON.parse(raw) as PendingTrigger;
  if (
    !value ||
    !/^[a-f0-9]{64}$/.test(value.txHash) ||
    (value.receipt !== undefined && typeof value.receipt !== "string")
  )
    throw new Error("Stored payment status cannot be read. Resolve it before paying again.");
  return { txHash: value.txHash, ...(value.receipt ? { receipt: value.receipt } : {}) };
}
export function savePendingTrigger(key: string, pending: PendingTrigger) {
  localStorage.setItem(key, JSON.stringify(pending));
  if (readPendingTrigger(key)?.txHash !== pending.txHash)
    throw new Error("Payment status could not be saved; transaction was not submitted.");
  window.dispatchEvent(new Event("paiflow-trigger-pending"));
}
export function clearPendingTrigger(key: string, hash: string) {
  if (readPendingTrigger(key)?.txHash === hash) localStorage.removeItem(key);
  window.dispatchEvent(new Event("paiflow-trigger-pending"));
}
const active = new Set<string>();
/** Same-page exclusion and mandatory origin-wide Web Locks before preparing. */
export async function withTriggerLock(key: string, action: () => Promise<void>) {
  if (active.has(key)) throw new Error("Another payment is already being processed.");
  active.add(key);
  try {
    if (navigator.locks) {
      await navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
        if (!lock) throw new Error("Another tab is already processing this payment.");
        await action();
      });
    } else
      throw new Error(
        "This browser cannot safely coordinate payment tabs. Open Paiflow in a current supported browser to pay.",
      );
  } finally {
    active.delete(key);
  }
}
