import {
  readSigningRecovery,
  isSigningAttempt,
  type SigningRecovery,
  type SigningAttempt,
} from "@/lib/wallet-signing-recovery";
import { withContractCallLock } from "@/lib/contract-call-pending";

/** Public recovery coordinates only: never persist a signed deployment envelope. */
export type PendingDeploy = SigningRecovery & { deploymentId: string; txHash: string };
export const DEPLOY_PENDING_EVENT = "paiflow-deploy-pending";
export const deployPendingKey = (flowId: string, network: "testnet" | "mainnet") =>
  `paiflow_deploy_pending:${flowId}:${network}`;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
export function readPendingDeploy(key: string): PendingDeploy | null {
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
    !HASH.test(value.txHash)
  ) {
    throw new Error("Stored deployment status is invalid. Resolve it before deploying again.");
  }
  return { deploymentId: value.deploymentId, txHash: value.txHash, ...readSigningRecovery(value) };
}
export function savePendingDeploy(key: string, pending: PendingDeploy): void {
  if (!ID.test(pending.deploymentId) || !HASH.test(pending.txHash) || readPendingDeploy(key)) {
    throw new Error("Resolve the pending deployment before deploying again.");
  }
  localStorage.setItem(
    key,
    JSON.stringify({
      deploymentId: pending.deploymentId,
      txHash: pending.txHash,
      ...readSigningRecovery(pending),
    }),
  );
  const actual = readPendingDeploy(key);
  if (actual?.deploymentId !== pending.deploymentId || actual.txHash !== pending.txHash) {
    throw new Error("Deployment status could not be saved. No transaction was submitted.");
  }
  window.dispatchEvent(new Event(DEPLOY_PENDING_EVENT));
}
/** Only authoritative chain finality clears the matching deployment/hash pair. */
export function clearPendingDeploy(key: string, pending: PendingDeploy): void {
  const actual = readPendingDeploy(key);
  if (actual?.deploymentId === pending.deploymentId && actual.txHash === pending.txHash) {
    localStorage.removeItem(key);
  }
  window.dispatchEvent(new Event(DEPLOY_PENDING_EVENT));
}
export const withDeployLock = withContractCallLock;

/** CAS transition immediately before dispatch; never interpret a signing marker as a send. */
export function markPendingDeploySubmitted(key: string, attempt: SigningAttempt): void {
  const actual = readPendingDeploy(key);
  if (!isSigningAttempt(actual, attempt)) throw new Error("Signing attempt ended or changed.");
  localStorage.setItem(key, JSON.stringify({ ...actual, phase: "submitted" }));
  const saved = readPendingDeploy(key);
  if (
    saved?.txHash !== attempt.txHash ||
    saved.phase !== "submitted" ||
    saved.attemptId !== attempt.attemptId
  )
    throw new Error("Submission status could not be saved. No transaction was submitted.");
  window.dispatchEvent(new Event(DEPLOY_PENDING_EVENT));
}
/** Explicit wallet rejection releases only its own still-signing reservation. */
export function rejectPendingDeploySigning(key: string, attempt: SigningAttempt): void {
  if (isSigningAttempt(readPendingDeploy(key), attempt)) localStorage.removeItem(key);
  window.dispatchEvent(new Event(DEPLOY_PENDING_EVENT));
}
