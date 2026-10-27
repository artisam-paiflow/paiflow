import { DEPLOY_PENDING_EVENT, type PendingDeploy } from "@/lib/deploy-pending";
import type { SigningAttempt } from "@/lib/wallet-signing-recovery";

/** Public provenance, never XDR. Absence is not evidence that signing never started. */
export type DeployPreparation = {
  deploymentId: string;
  txHash: string;
  address: string;
  state: "ready" | "signing";
  attemptId?: string;
};
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
export const deployPreparationKey = (pendingKey: string) => `${pendingKey}:preparation`;
export const legacyDeployRecoveryKey = (flowId: string, network: "testnet" | "mainnet") =>
  `paiflow-deploy-recovery:${network}:${flowId}`;

export function readDeployPreparation(key: string): DeployPreparation | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== "object" ||
    !("deploymentId" in value) ||
    typeof value.deploymentId !== "string" ||
    !ID.test(value.deploymentId) ||
    !("txHash" in value) ||
    typeof value.txHash !== "string" ||
    !HASH.test(value.txHash) ||
    !("address" in value) ||
    typeof value.address !== "string" ||
    !/^G[A-Z2-7]{55}$/.test(value.address) ||
    !("state" in value) ||
    (value.state !== "ready" && value.state !== "signing") ||
    (value.state === "signing" &&
      (!("attemptId" in value) || typeof value.attemptId !== "string" || !ID.test(value.attemptId)))
  )
    throw new Error("Stored deployment preparation is invalid. Resolve it before signing again.");
  const attemptId =
    "attemptId" in value && typeof value.attemptId === "string" ? value.attemptId : undefined;
  return {
    deploymentId: value.deploymentId,
    txHash: value.txHash,
    address: value.address,
    state: value.state,
    ...(value.state === "signing" && attemptId ? { attemptId } : {}),
  };
}
function write(key: string, value: DeployPreparation): void {
  localStorage.setItem(key, JSON.stringify(value));
  const actual = readDeployPreparation(key);
  if (JSON.stringify(actual) !== JSON.stringify(value))
    throw new Error("Deployment preparation could not be saved. No signature was requested.");
  window.dispatchEvent(new Event(DEPLOY_PENDING_EVENT));
}
export function saveDeployPreparation(
  key: string,
  value: Omit<DeployPreparation, "state" | "attemptId">,
): void {
  if (readDeployPreparation(key)) throw new Error("Resolve the existing preparation first.");
  write(key, {
    deploymentId: value.deploymentId,
    txHash: value.txHash,
    address: value.address,
    state: "ready",
  });
}
/** Consume safe-to-sign provenance BEFORE the pending signing marker/wallet call. */
export function consumeDeployPreparation(key: string, attempt: SigningAttempt): void {
  const actual = readDeployPreparation(key);
  if (!actual || actual.state !== "ready" || actual.txHash !== attempt.txHash)
    throw new Error("The original preparation is not safe to sign again.");
  write(key, { ...actual, state: "signing", attemptId: attempt.attemptId });
}
/** Only the matching explicit wallet refusal can restore safe-to-sign provenance. */
export function rejectDeployPreparation(key: string, attempt: SigningAttempt): void {
  const actual = readDeployPreparation(key);
  if (
    actual?.state !== "signing" ||
    actual.txHash !== attempt.txHash ||
    actual.attemptId !== attempt.attemptId
  )
    return;
  write(key, {
    deploymentId: actual.deploymentId,
    txHash: actual.txHash,
    address: actual.address,
    state: "ready",
  });
}
export function clearDeployPreparation(
  key: string,
  identity: Pick<PendingDeploy, "deploymentId" | "txHash">,
): void {
  const actual = readDeployPreparation(key);
  if (actual?.deploymentId === identity.deploymentId && actual.txHash === identity.txHash)
    localStorage.removeItem(key);
  window.dispatchEvent(new Event(DEPLOY_PENDING_EVENT));
}
