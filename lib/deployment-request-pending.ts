import { CONTRACT_CALL_PENDING_EVENT } from "@/lib/contract-call-pending";

/**
 * Public recovery state for multi-transaction deployment requests. Preparation may
 * already send relayer transactions, even before a wallet has signed anything.
 * Shared signing must honour these reservations independently of feature flags.
 */
export type PendingDeploymentRequest =
  | { requestId: string; phase: "prepare" }
  | { requestId: string; phase: "transactions"; txHashes: string[] };
// Keep the historical namespace: changing it would hide unresolved recipient
// updates from older clients. This is compatibility, not a feature-enable check.
export const deploymentRequestPendingKey = (deploymentId: string, network: string) =>
  `paiflow_payroll_pending:${deploymentId}:${network}`;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
function parse(value: unknown): PendingDeploymentRequest {
  if (
    !value ||
    typeof value !== "object" ||
    !("requestId" in value) ||
    typeof value.requestId !== "string" ||
    !ID.test(value.requestId) ||
    !("phase" in value)
  )
    throw new Error(
      "Deployment request recovery state is invalid. Resolve it before another action.",
    );
  if (value.phase === "prepare") return { requestId: value.requestId, phase: "prepare" };
  if (
    value.phase !== "transactions" ||
    !("txHashes" in value) ||
    !Array.isArray(value.txHashes) ||
    value.txHashes.length === 0 ||
    value.txHashes.some((hash: unknown) => typeof hash !== "string" || !HASH.test(hash)) ||
    new Set(value.txHashes).size !== value.txHashes.length
  )
    throw new Error(
      "Deployment request recovery hashes are invalid. Resolve them before another action.",
    );
  return { requestId: value.requestId, phase: "transactions", txHashes: [...value.txHashes] };
}
export function readPendingDeploymentRequest(key: string): PendingDeploymentRequest | null {
  const raw = localStorage.getItem(key);
  return raw === null ? null : parse(JSON.parse(raw));
}
function matches(a: PendingDeploymentRequest | null, b: PendingDeploymentRequest): boolean {
  return JSON.stringify(a) === JSON.stringify(parse(b));
}
function notify() {
  // Shared notification makes ordinary contract actions refresh their admission gate.
  window.dispatchEvent(new Event(CONTRACT_CALL_PENDING_EVENT));
}
export function savePendingDeploymentRequest(
  key: string,
  value: PendingDeploymentRequest,
  expected?: PendingDeploymentRequest,
): void {
  const pending = parse(value);
  if (
    expected &&
    (expected.phase !== "prepare" ||
      pending.phase !== "transactions" ||
      expected.requestId !== pending.requestId)
  ) {
    throw new Error("A deployment request may advance to its hashes only once.");
  }
  const actual = readPendingDeploymentRequest(key);
  if (expected ? !matches(actual, expected) : actual !== null)
    throw new Error("Resolve the pending deployment request before another action.");
  localStorage.setItem(key, JSON.stringify(pending));
  if (!matches(readPendingDeploymentRequest(key), pending))
    throw new Error(
      "Deployment request recovery state could not be saved. No new request was sent.",
    );
  notify();
}
/** Call only for the unsigned-only route response, or all hashes at authoritative finality. */
export function clearPendingDeploymentRequest(
  key: string,
  expected: PendingDeploymentRequest,
): void {
  if (matches(readPendingDeploymentRequest(key), expected)) localStorage.removeItem(key);
  notify();
}
export function assertNoPendingDeploymentRequest(deploymentId: string, network: string): void {
  if (readPendingDeploymentRequest(deploymentRequestPendingKey(deploymentId, network)))
    throw new Error(
      "A deployment request is unresolved. Check the original recipient-update status before another action.",
    );
}
