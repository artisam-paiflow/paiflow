/** Browser recovery state contains public hashes only, never signed envelopes. */
export type PendingContractCall = { txHash: string };
export const CONTRACT_CALL_PENDING_EVENT = "paiflow-contract-call-pending";
export const contractCallPendingKey = (deploymentId: string, network: string) =>
  `paiflow_contract_call_pending:${deploymentId}:${network}`;

export function readPendingContractCall(key: string): PendingContractCall | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== "object" ||
    !("txHash" in value) ||
    typeof value.txHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.txHash)
  ) {
    throw new Error(
      "Stored transaction status is invalid. Resolve it before starting another action.",
    );
  }
  return { txHash: value.txHash };
}

export function savePendingContractCall(key: string, pending: PendingContractCall): void {
  if (!/^[a-f0-9]{64}$/.test(pending.txHash) || readPendingContractCall(key)) {
    throw new Error("Resolve the pending transaction before starting another action.");
  }
  // Serialize only the allowlisted public field, even if a caller passes extras.
  localStorage.setItem(key, JSON.stringify({ txHash: pending.txHash }));
  if (readPendingContractCall(key)?.txHash !== pending.txHash) {
    throw new Error("Transaction status could not be saved; transaction was not submitted.");
  }
  window.dispatchEvent(new Event(CONTRACT_CALL_PENDING_EVENT));
}

/** Call only after authoritative SUCCESS or FAILED; never clear a different hash. */
export function clearPendingContractCall(key: string, hash: string): void {
  if (readPendingContractCall(key)?.txHash === hash) localStorage.removeItem(key);
  window.dispatchEvent(new Event(CONTRACT_CALL_PENDING_EVENT));
}

const active = new Set<string>();

/** Same-page and origin-wide exclusion, with the durable marker checked inside. */
export async function withContractCallLock(
  key: string,
  action: () => Promise<void>,
): Promise<void> {
  if (active.has(key))
    throw new Error("Another transaction for this deployment is being processed.");
  active.add(key);
  try {
    if (!navigator.locks) {
      throw new Error("This browser cannot safely coordinate transactions. Use a current browser.");
    }
    await navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
      if (!lock) throw new Error("Another tab is processing a transaction for this deployment.");
      await action();
    });
  } finally {
    active.delete(key);
  }
}
