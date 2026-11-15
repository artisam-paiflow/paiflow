import "server-only";
import { ZodError } from "zod";
import type { Deployment, WalletControlIntent } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError, type AppErrorCode } from "@/lib/errors";
import { lockDeployment, withDeploymentWork } from "@/lib/deployments/service-work";
import { ConditionalExecutionDiscoverySchema } from "@/lib/api/v1/conditional-execution-schema";
import {
  prepareConditionalExecutionPayment,
  submitConditionalExecutionPayment,
} from "@/lib/api/v1/conditional-execution-payments";
import { executionRequestDigest } from "@/lib/api/v1/execution-intent";
import { reconcileControlIntent, parseControlTransaction } from "@/lib/api/v1/control-intent";
import { readConditionalExecutionState } from "@/lib/stellar/conditional-execution-state";
import { verifyConditionalDeploymentOriginal } from "@/lib/stellar/prepare-conditional-deploy";
import { verifyConditionalHostedOwnershipProof } from "@/lib/stellar/conditional-hosted-ownership";
import {
  ConditionalHostedPreparedSchema,
  ConditionalHostedPrepareSchema,
  ConditionalHostedReceiptSchema,
  ConditionalHostedSubmittedSchema,
  type ConditionalHostedPrepare,
} from "./conditional-schema";
import type { HostedSubmit } from "./schema";
import {
  assertHostedReceiptCapability,
  readHostedReceiptForVersion,
  requestKeyHash,
  hostedKeyHash,
  visibilityAdmission,
} from "./service";
import {
  conditionalHostedPaymentReview,
  assertConditionalHostedCurrent,
} from "./conditional-review";
import type { SupportedConditionalExecutionState } from "@/lib/api/v1/conditional-execution-schema";

/** Metadata is a prerequisite only; live availability always needs the fenced reader. */
export function assertConditionalHostedDeployment(deployment: Deployment) {
  if (
    deployment.network !== env().STELLAR_NETWORK ||
    deployment.status !== "CONFIRMED" ||
    deployment.templateVersionId
  )
    throw new AppError("NOT_FOUND", "Payment form is unavailable");
  try {
    verifyConditionalDeploymentOriginal(deployment);
  } catch {
    throw new AppError("NOT_FOUND", "Payment form is unavailable");
  }
}
/** Recovery-only loading never asks the chain or requires current visibility. */
export async function conditionalHostedDeployment(id: string, requireEnabled = true) {
  const deployment = await db.deployment.findFirst({
    where: { id, network: env().STELLAR_NETWORK, status: "CONFIRMED" },
  });
  if (!deployment) throw new AppError("NOT_FOUND", "Payment form is unavailable");
  if (requireEnabled) {
    assertConditionalHostedDeployment(deployment);
    if (!deployment.hostedExecutionEnabled || deployment.serviceState !== "ACTIVE")
      throw new AppError("NOT_FOUND", "Payment form is unavailable");
  }
  return deployment;
}
export async function readConditionalHostedState(deployment: Deployment) {
  assertConditionalHostedDeployment(deployment);
  if (!deployment.hostedExecutionEnabled || deployment.serviceState !== "ACTIVE")
    throw new AppError("NOT_FOUND", "Payment form is unavailable");
  const state = ConditionalExecutionDiscoverySchema.parse(
    await readConditionalExecutionState(deployment),
  );
  if (!state.supported) throw new AppError("NOT_FOUND", "Payment form is unavailable");
  return state;
}
export async function readConditionalHostedReceipt(deploymentId: string, key: string) {
  return readHostedReceiptForVersion(deploymentId, key, 2);
}
function receipt(row: WalletControlIntent) {
  return ConditionalHostedReceiptSchema.parse({
    version: 2,
    intent: row.id,
    txHash: row.txHash,
    state: row.state,
    network: row.network,
    expiresAt: new Date(Number(row.maxTime) * 1000).toISOString(),
  });
}
export async function prepareConditionalHostedPayment(
  deployment: Deployment,
  raw: ConditionalHostedPrepare,
) {
  const input = ConditionalHostedPrepareSchema.parse(raw);
  await conditionalHostedDeployment(deployment.id);
  const previous = await db.walletControlIntent.findFirst({
    where: {
      deploymentId: deployment.id,
      network: env().STELLAR_NETWORK,
      idempotencyKeyHash: requestKeyHash(input.recoveryKey),
    },
  });
  if (previous) {
    assertHostedReceiptCapability(previous, input.recoveryKey, 2);
    if (
      previous.walletAddress !== input.payment.from ||
      previous.requestDigest !==
        executionRequestDigest({
          version: 2,
          deploymentId: deployment.id,
          network: deployment.network,
          input: input.payment,
        })
    )
      throw new AppError("CONFLICT", "Recovery key already identifies a different payment");
  } else
    verifyConditionalHostedOwnershipProof(
      deployment.id,
      { recoveryKey: input.recoveryKey, payment: input.payment },
      input.ownershipProofXdr,
    );
  let reviewed: SupportedConditionalExecutionState | undefined;
  const prepared = await prepareConditionalExecutionPayment(
    deployment,
    input.payment,
    requestKeyHash(input.recoveryKey),
    async (client) => {
      await visibilityAdmission(deployment.id)(client);
      if (!previous)
        verifyConditionalHostedOwnershipProof(
          deployment.id,
          { recoveryKey: input.recoveryKey, payment: input.payment },
          input.ownershipProofXdr,
        );
    },
    hostedKeyHash(input.recoveryKey),
    (state) => {
      reviewed = state;
    },
  );
  await readConditionalHostedReceipt(deployment.id, input.recoveryKey);
  const current = reviewed ?? (await readConditionalHostedState(deployment));
  try {
    assertConditionalHostedCurrent(current, prepared.execution);
  } catch {
    throw new AppError(
      "CONFLICT",
      "Configuration changed; check this payment receipt before preparing again",
    );
  }
  return ConditionalHostedPreparedSchema.parse({
    version: 2,
    prepared,
    feeStroops: parseControlTransaction(prepared.xdr).fee,
    ...conditionalHostedPaymentReview(prepared.execution),
  });
}
export async function submitConditionalHostedPayment(
  deployment: Deployment,
  input: HostedSubmit,
  ip: string,
) {
  const saved = await readConditionalHostedReceipt(deployment.id, input.recoveryKey);
  if (saved.id.toLowerCase() !== input.intent.toLowerCase())
    throw new AppError("NOT_FOUND", "Payment receipt not found");
  if (saved.state === "PREPARED") await conditionalHostedDeployment(deployment.id);
  const result = await submitConditionalExecutionPayment({
    deployment,
    signedXdr: input.signedXdr,
    intent: saved.id,
    wait: false,
    ip,
    assertAdmission: visibilityAdmission(deployment.id),
  });
  return ConditionalHostedSubmittedSchema.parse({
    version: 2,
    txHash: result.txHash,
    status: result.status,
  });
}
export async function reconcileConditionalHostedPayment(deployment: Deployment, key: string) {
  const saved = await readConditionalHostedReceipt(deployment.id, key);
  if (deployment.serviceState === "RETIRED") return receipt(saved);
  return withDeploymentWork(
    deployment.id,
    "hosted-execution:reconcile",
    async () => receipt(await reconcileControlIntent(saved.id, deployment.id, "payment.execute")),
    true,
  );
}
export async function setConditionalHostedVisibility(
  deployment: Deployment,
  ownerId: string,
  enabled: boolean,
  ip: string,
) {
  if (deployment.ownerId !== ownerId) throw new AppError("NOT_FOUND", "Deployment not found");
  assertConditionalHostedDeployment(deployment);
  if (enabled) {
    const state = ConditionalExecutionDiscoverySchema.parse(
      await readConditionalExecutionState(deployment),
    );
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
const messages: Record<AppErrorCode, string> = {
  UNAUTHENTICATED: "Payment access is unavailable",
  FORBIDDEN: "Payment access is unavailable",
  NOT_FOUND: "Payment form or receipt is unavailable",
  VALIDATION: "Payment input is invalid",
  CONFLICT: "The original payment must be checked before continuing",
  RATE_LIMITED: "Too many payment requests",
  UPSTREAM_RPC: "Payment network is temporarily unavailable",
  INSUFFICIENT_FUNDS: "Insufficient funds for this payment",
  INTERNAL: "Payment request could not be completed",
};
/** Anonymous v2 errors never serialize private context or raw technical diagnostics. */
export function conditionalHostedPublicError(error: unknown): AppError {
  if (error instanceof AppError) {
    const ownership =
      error.code === "VALIDATION" &&
      error.message === "Verify ownership of the payer wallet before preparing this payment" &&
      error.fields?.ownershipProofXdr?.length === 1 &&
      error.fields.ownershipProofXdr[0] === "A current wallet ownership signature is required";
    return new AppError(
      error.code,
      ownership
        ? "Verify ownership of the payer wallet before preparing this payment"
        : messages[error.code],
      ownership
        ? { ownershipProofXdr: ["A current wallet ownership signature is required"] }
        : undefined,
      undefined,
      error.retryAfterSeconds,
    );
  }
  return new AppError(
    error instanceof ZodError ? "VALIDATION" : "INTERNAL",
    error instanceof ZodError ? messages.VALIDATION : messages.INTERNAL,
  );
}
