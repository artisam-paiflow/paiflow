import { CONTRACT_CALL_PENDING_EVENT } from "@/lib/contract-call-pending";

/** Public recovery state only. A prepare request may already send relayer transactions. */
export type PendingPayroll =
  | { requestId: string; phase: "prepare" }
  | { requestId: string; phase: "transactions"; txHashes: string[] };
export const payrollPendingKey = (deploymentId: string, network: string) =>
  `paiflow_payroll_pending:${deploymentId}:${network}`;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
function parse(value: unknown): PendingPayroll {
  if (
    !value ||
    typeof value !== "object" ||
    !("requestId" in value) ||
    typeof value.requestId !== "string" ||
    !ID.test(value.requestId) ||
    !("phase" in value)
  )
    throw new Error("Payroll recovery state is invalid. Resolve it before another action.");
  if (value.phase === "prepare") return { requestId: value.requestId, phase: "prepare" };
  if (
    value.phase !== "transactions" ||
    !("txHashes" in value) ||
    !Array.isArray(value.txHashes) ||
    value.txHashes.length === 0 ||
    value.txHashes.some((hash: unknown) => typeof hash !== "string" || !HASH.test(hash)) ||
    new Set(value.txHashes).size !== value.txHashes.length
  )
    throw new Error("Payroll recovery hashes are invalid. Resolve them before another action.");
  return { requestId: value.requestId, phase: "transactions", txHashes: [...value.txHashes] };
}
export function readPendingPayroll(key: string): PendingPayroll | null {
  const raw = localStorage.getItem(key);
  return raw === null ? null : parse(JSON.parse(raw));
}
function matches(a: PendingPayroll | null, b: PendingPayroll): boolean {
  return JSON.stringify(a) === JSON.stringify(parse(b));
}
function notify() {
  // Shared notification makes ordinary contract actions refresh their admission gate.
  window.dispatchEvent(new Event(CONTRACT_CALL_PENDING_EVENT));
}
export function savePendingPayroll(
  key: string,
  value: PendingPayroll,
  expected?: PendingPayroll,
): void {
  const pending = parse(value);
  if (
    expected &&
    (expected.phase !== "prepare" ||
      pending.phase !== "transactions" ||
      expected.requestId !== pending.requestId)
  ) {
    throw new Error("A payroll request may advance to its hashes only once.");
  }
  const actual = readPendingPayroll(key);
  if (expected ? !matches(actual, expected) : actual !== null)
    throw new Error("Resolve the pending payroll request before another action.");
  localStorage.setItem(key, JSON.stringify(pending));
  if (!matches(readPendingPayroll(key), pending))
    throw new Error("Payroll recovery state could not be saved. No new request was sent.");
  notify();
}
/** Call only for the unsigned-only route response, or all hashes at authoritative finality. */
export function clearPendingPayroll(key: string, expected: PendingPayroll): void {
  if (matches(readPendingPayroll(key), expected)) localStorage.removeItem(key);
  notify();
}
export function assertNoPendingPayroll(deploymentId: string, network: string): void {
  if (readPendingPayroll(payrollPendingKey(deploymentId, network)))
    throw new Error("A payroll request is unresolved. Check payroll status before another action.");
}
