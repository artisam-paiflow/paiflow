import { readSigningRecovery } from "@/lib/wallet-signing-recovery";
/** Existing browser allowance protocol; expose only public hash for cross-surface gates. */
export const allowancePendingKey = (deploymentId: string, network: string) =>
  `paiflow_allowance_pending:${deploymentId}:${network}`;

export function readAllowancePendingHash(deploymentId: string, network: string): string | null {
  const raw = localStorage.getItem(allowancePendingKey(deploymentId, network));
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== "object" ||
    !("txHash" in value) ||
    typeof value.txHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.txHash) ||
    !("intent" in value) ||
    typeof value.intent !== "string" ||
    !value.intent
  )
    throw new Error(
      "Stored approval status is invalid. Resolve it on the allowance page before starting another action.",
    );
  readSigningRecovery(value);
  return value.txHash;
}
