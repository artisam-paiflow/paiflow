import "server-only";
import { createHash } from "node:crypto";
import type { Deployment, WalletControlIntent, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { timingSafeEqualString } from "@/lib/auth/timing-safe";
import { lockDeployment, withDeploymentWork } from "@/lib/deployments/service-work";
import { hasExecutionPolicies } from "@/lib/api/v1/execution-schema";
import { prepareExecutionPayment, submitExecutionPayment } from "@/lib/api/v1/execution-payments";
import { reconcileControlIntent, parseControlTransaction } from "@/lib/api/v1/control-intent";
import { readExecutionState } from "@/lib/stellar/execution-state";
import { verifyHostedOwnershipProof } from "@/lib/stellar/hosted-ownership";
import { executionRequestDigest } from "@/lib/api/v1/execution-intent";
import {
  HostedPreparedSchema,
  HostedReceiptSchema,
  HostedRecoveryKeySchema,
  type HostedPrepare,
  type HostedSubmit,
} from "./schema";
import { hostedPaymentReview } from "./review";

export function hostedKeyHash(key: string): string {
  return createHash("sha256").update(HostedRecoveryKeySchema.parse(key)).digest("hex");
}
function requestKeyHash(key: string): string {
  return createHash("sha256")
    .update(`hosted-execution:${HostedRecoveryKeySchema.parse(key)}`)
    .digest("hex");
}
function visibilityAdmission(deploymentId: string) {
  return async (tx: Prisma.TransactionClient) => {
    const current = await tx.deployment.findUnique({
      where: { id: deploymentId },
      select: { hostedExecutionEnabled: true },
    });
    if (!current?.hostedExecutionEnabled)
      throw new AppError("NOT_FOUND", "Payment form is unavailable");
  };
}
/** No graph, contact, token or owner fields leave this service's response allowlists. */
export async function hostedDeployment(id: string, requireEnabled = true) {
  const deployment = await db.deployment.findFirst({
    where: { id, network: env().STELLAR_NETWORK, status: "CONFIRMED" },
  });
  if (
    !deployment ||
    !hasExecutionPolicies(deployment.graphSnapshot) ||
    (requireEnabled && (!deployment.hostedExecutionEnabled || deployment.serviceState !== "ACTIVE"))
  )
    throw new AppError("NOT_FOUND", "Payment form is unavailable");
  return deployment;
}
export async function readHostedReceipt(deploymentId: string, key: string) {
  const row = await db.walletControlIntent.findFirst({
    where: {
      deploymentId,
      network: env().STELLAR_NETWORK,
      action: "payment.execute",
      idempotencyKeyHash: requestKeyHash(key),
    },
  });
  if (
    !row ||
    (row.hostedAccessHash
      ? !timingSafeEqualString(row.hostedAccessHash, hostedKeyHash(key))
      : // Retained pre-atomic-marker history: knowledge of the original random key
        // still proves this namespaced, exact receipt capability after service closes.
        !timingSafeEqualString(row.idempotencyKeyHash ?? "", requestKeyHash(key)) ||
        !/^[a-f0-9]{64}$/.test(row.requestDigest ?? ""))
  )
    throw new AppError("NOT_FOUND", "Payment receipt not found");
  return row;
}
function receipt(row: WalletControlIntent) {
  return HostedReceiptSchema.parse({
    intent: row.id,
    txHash: row.txHash,
    state: row.state,
    network: row.network,
    expiresAt: new Date(Number(row.maxTime) * 1000).toISOString(),
  });
}
export async function prepareHostedPayment(deployment: Deployment, input: HostedPrepare) {
  // No caller-provided credential can grant visibility. Recheck every new preparation.
  await hostedDeployment(deployment.id);
  const previous = await db.walletControlIntent.findFirst({
    where: {
      deploymentId: deployment.id,
      network: env().STELLAR_NETWORK,
      idempotencyKeyHash: requestKeyHash(input.recoveryKey),
    },
  });
  if (previous) {
    // The random capability and exact original request recover even a crash before
    // hostedAccessHash was marked. They never authorize a different preparation.
    if (
      previous.action !== "payment.execute" ||
      previous.walletAddress !== input.payment.from ||
      previous.requestDigest !==
        executionRequestDigest({
          deploymentId: deployment.id,
          network: deployment.network,
          input: input.payment,
        }) ||
      (previous.hostedAccessHash !== null &&
        !timingSafeEqualString(previous.hostedAccessHash, hostedKeyHash(input.recoveryKey)))
    )
      throw new AppError("CONFLICT", "Recovery key already identifies a different payment");
  } else {
    verifyHostedOwnershipProof(
      deployment.id,
      { recoveryKey: input.recoveryKey, payment: input.payment },
      input.ownershipProofXdr,
    );
  }
  const prepared = await prepareExecutionPayment(
    deployment,
    input.payment,
    requestKeyHash(input.recoveryKey),
    async (client) => {
      await visibilityAdmission(deployment.id)(client);
      // A slow simulation must not admit a proof after its validity window.
      if (!previous)
        verifyHostedOwnershipProof(
          deployment.id,
          { recoveryKey: input.recoveryKey, payment: input.payment },
          input.ownershipProofXdr,
        );
    },
    hostedKeyHash(input.recoveryKey),
  );
  if (!prepared.intent || !prepared.execution)
    throw new AppError("INTERNAL", "Incomplete payment preparation");
  await readHostedReceipt(deployment.id, input.recoveryKey);
  const current = await readExecutionState(deployment);
  if (
    !current.supported ||
    current.nodes.length !== prepared.execution.nodes.length ||
    current.assetContract !== prepared.execution.assetContract ||
    current.rootContract !== prepared.execution.rootContract ||
    current.nodes.some(
      (node, index) =>
        node.nodeId !== prepared.execution!.nodes[index]?.nodeId ||
        node.contractAddress !== prepared.execution!.nodes[index]?.contractAddress ||
        node.expectedRevision !== prepared.execution!.nodes[index]?.expectedRevision,
    )
  )
    throw new AppError(
      "CONFLICT",
      "Configuration changed; check this payment receipt before preparing again",
    );
  return HostedPreparedSchema.parse({
    prepared,
    feeStroops: parseControlTransaction(prepared.xdr).fee,
    ...hostedPaymentReview(current, prepared.execution),
  });
}
export async function submitHostedPayment(deployment: Deployment, input: HostedSubmit, ip: string) {
  const saved = await readHostedReceipt(deployment.id, input.recoveryKey);
  if (saved.id !== input.intent) throw new AppError("NOT_FOUND", "Payment receipt not found");
  if (saved.state === "PREPARED") await hostedDeployment(deployment.id);
  // The common service checks exact envelope, wallet signature, live revisions and single-send claim.
  const transaction = await submitExecutionPayment({
    deployment,
    signedXdr: input.signedXdr,
    intent: saved.id,
    wait: false,
    ip,
    assertAdmission: visibilityAdmission(deployment.id),
  });
  // Return only public transaction identity/status; no events, contacts or raw diagnostics.
  return { txHash: transaction.txHash, status: transaction.status };
}
export async function reconcileHostedPayment(deployment: Deployment, key: string) {
  const saved = await readHostedReceipt(deployment.id, key);
  if (deployment.serviceState === "RETIRED") return receipt(saved);
  // This is recovery of an already admitted financial obligation, including after opt-out/retirement.
  return withDeploymentWork(
    deployment.id,
    "hosted-execution:reconcile",
    async () => receipt(await reconcileControlIntent(saved.id, deployment.id, "payment.execute")),
    true,
  );
}
export async function setHostedVisibility(
  deployment: Deployment,
  ownerId: string,
  enabled: boolean,
  ip: string,
) {
  if (
    deployment.ownerId !== ownerId ||
    deployment.status !== "CONFIRMED" ||
    deployment.network !== env().STELLAR_NETWORK ||
    !hasExecutionPolicies(deployment.graphSnapshot)
  )
    throw new AppError("NOT_FOUND", "Deployment not found");
  if (enabled) {
    const state = await readExecutionState(deployment);
    if (!state.supported)
      throw new AppError("VALIDATION", "This deployment cannot accept hosted execution payments");
  }
  await db.$transaction(async (tx) => {
    const service = await lockDeployment(tx, deployment.id);
    if (service.serviceState !== "ACTIVE")
      throw new AppError("CONFLICT", "Deployment service is closed");
    await tx.deployment.update({
      where: { id: deployment.id },
      data: { hostedExecutionEnabled: enabled },
    });
    await tx.auditLog.create({
      data: {
        userId: ownerId,
        action: "HOSTED_EXECUTION_VISIBILITY",
        ip,
        metadata: { deploymentId: deployment.id, enabled },
      },
    });
  });
  return { enabled };
}
