import { z } from "zod";
import {
  ConditionalDeployPrepareSchema,
  type ConditionalDeployPrepare,
} from "@/lib/deployments/conditional-prepare-schema";
import { WalletAddressSchema } from "@/lib/flows/field-policies";
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
  if (value && typeof value === "object" && "version" in value)
    throw new Error("Use the strict versioned deployment preparation reader");
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
  const actual = readReadyDeployPreparation(key);
  if (!actual || actual.state !== "ready" || actual.txHash !== attempt.txHash)
    throw new Error("The original preparation is not safe to sign again.");
  writeCompatible(key, { ...actual, state: "signing", attemptId: attempt.attemptId });
}
/** Only the matching explicit wallet refusal can restore safe-to-sign provenance. */
export function rejectDeployPreparation(key: string, attempt: SigningAttempt): void {
  const actual = readReadyDeployPreparation(key);
  if (
    actual?.state !== "signing" ||
    actual.txHash !== attempt.txHash ||
    actual.attemptId !== attempt.attemptId
  )
    return;
  writeCompatible(key, {
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
  const actual = readReadyDeployPreparation(key);
  if (actual?.deploymentId === identity.deploymentId && actual.txHash === identity.txHash)
    localStorage.removeItem(key);
  window.dispatchEvent(new Event(DEPLOY_PENDING_EVENT));
}

/** Conditional request provenance shares the existing key/lock, before the
 * server admits an original. It never implies a wallet signature or finality. */
export const ConditionalDeployPreparationSchema = z
  .discriminatedUnion("state", [
    z
      .object({
        version: z.literal(2),
        state: z.literal("preparing"),
        network: z.enum(["testnet", "mainnet"]),
        request: ConditionalDeployPrepareSchema,
      })
      .strict(),
    z
      .object({
        version: z.literal(2),
        state: z.literal("ready"),
        network: z.enum(["testnet", "mainnet"]),
        request: ConditionalDeployPrepareSchema,
        deploymentId: z.uuid(),
        txHash: z.string().regex(HASH),
        address: WalletAddressSchema,
      })
      .strict(),
    z
      .object({
        version: z.literal(2),
        state: z.literal("signing"),
        network: z.enum(["testnet", "mainnet"]),
        request: ConditionalDeployPrepareSchema,
        deploymentId: z.uuid(),
        txHash: z.string().regex(HASH),
        address: WalletAddressSchema,
        attemptId: z.uuid(),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    if (value.state !== "preparing" && value.address !== value.request.sourceAccount)
      ctx.addIssue({
        code: "custom",
        message: "Conditional original source differs from its saved request",
      });
  });
export type ConditionalDeployPreparation = z.infer<typeof ConditionalDeployPreparationSchema>;
export function readConditionalDeployPreparation(key: string): ConditionalDeployPreparation | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (value && typeof value === "object" && ("version" in value || "request" in value))
    return ConditionalDeployPreparationSchema.parse(value);
  return null;
}
/** Strict generation dispatch; a preparing record has no admitted hash yet. */
export function readReadyDeployPreparation(key: string): DeployPreparation | null {
  const conditional = readConditionalDeployPreparation(key);
  if (!conditional) return readDeployPreparation(key);
  if (conditional.state === "preparing") return null;
  return {
    deploymentId: conditional.deploymentId,
    txHash: conditional.txHash,
    address: conditional.address,
    state: conditional.state,
    ...(conditional.state === "signing" ? { attemptId: conditional.attemptId } : {}),
  };
}
function writeConditional(key: string, raw: ConditionalDeployPreparation): void {
  const value = ConditionalDeployPreparationSchema.parse(raw);
  localStorage.setItem(key, JSON.stringify(value));
  if (JSON.stringify(readConditionalDeployPreparation(key)) !== JSON.stringify(value))
    throw new Error(
      "Conditional preparation could not be saved. Retain the original key before retrying.",
    );
  window.dispatchEvent(new Event(DEPLOY_PENDING_EVENT));
}
export function beginConditionalDeployPreparation(
  key: string,
  request: ConditionalDeployPrepare,
  network: "testnet" | "mainnet",
): void {
  if (localStorage.getItem(key) !== null)
    throw new Error("Resolve the existing preparation before creating another key");
  writeConditional(key, {
    version: 2,
    state: "preparing",
    request: ConditionalDeployPrepareSchema.parse(request),
    network,
  });
}
export function completeConditionalDeployPreparation(
  key: string,
  expected: ConditionalDeployPreparation,
  identity: Omit<DeployPreparation, "state" | "attemptId">,
): void {
  const actual = readConditionalDeployPreparation(key);
  if (
    !actual ||
    actual.state !== "preparing" ||
    JSON.stringify(actual) !== JSON.stringify(expected) ||
    identity.address !== actual.request.sourceAccount
  )
    throw new Error("Original conditional preparation request changed");
  writeConditional(key, {
    version: 2,
    state: "ready",
    request: actual.request,
    network: actual.network,
    ...identity,
  });
}
function writeCompatible(key: string, value: DeployPreparation): void {
  const conditional = readConditionalDeployPreparation(key);
  if (!conditional) {
    write(key, value);
    return;
  }
  if (conditional.state === "preparing") throw new Error("No admitted original is ready to sign");
  writeConditional(
    key,
    ConditionalDeployPreparationSchema.parse({
      version: 2,
      network: conditional.network,
      request: conditional.request,
      ...value,
    }),
  );
}
