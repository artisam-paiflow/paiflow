import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Deployment, WebhookAttempt } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { AppError } from "@/lib/errors";
import { getTransactionStatus } from "@/lib/api/v1/transaction-status";
import { submitWebhookExecuteTx } from "@/lib/stellar/trigger";

export const WebhookIdempotencyKeySchema = z
  .string()
  .regex(
    /^[A-Za-z0-9._:-]{1,128}$/,
    "Use 1–128 letters, digits, dots, underscores, colons or hyphens",
  );
export type WebhookInput = { escrow: boolean; from?: string; amount?: string; auth?: string[] };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
/** Fingerprint effective operation arguments; omitted escrow amount and zero mean the same thing. */
export function webhookRequestHash(input: WebhookInput): string {
  return digest(
    JSON.stringify(
      input.escrow
        ? { escrow: true, amount: BigInt(input.amount ?? "0").toString() }
        : {
            escrow: false,
            from: input.from,
            amount: BigInt(input.amount!).toString(),
            auth: input.auth ?? [],
          },
    ),
  );
}
const mutable = ["PREPARING", "SUBMITTING", "UNKNOWN"];
const response = (attempt: WebhookAttempt) => ({
  attemptId: attempt.id,
  ...(attempt.txHash ? { txHash: attempt.txHash } : {}),
  network: attempt.network,
  status:
    attempt.status === "PREPARING" || attempt.status === "SUBMITTING" ? "UNKNOWN" : attempt.status,
  ...(attempt.ledger ? { ledger: attempt.ledger } : {}),
  ...(attempt.errorCode
    ? {
        error: {
          code: attempt.errorCode,
          message:
            attempt.errorCode === "PREPARATION_FAILED"
              ? "The original attempt failed before submission"
              : attempt.errorCode === "RPC_REJECTED"
                ? "The network refused the original submission"
                : attempt.errorCode === "ONCHAIN_FAILED"
                  ? "The original transaction failed on the network"
                  : "The original outcome is unknown; do not create a new payout",
        },
      }
    : {}),
});

async function replay(deployment: Deployment, attempt: WebhookAttempt) {
  if (attempt.txHash && !["SUCCESS", "FAILED"].includes(attempt.status)) {
    // Lookup never submits; absence cannot reopen the event key.
    const result = await getTransactionStatus(deployment, attempt.txHash);
    if (["SUCCESS", "FAILED"].includes(result.status)) {
      await db.webhookAttempt.updateMany({
        where: { id: attempt.id, status: { notIn: ["SUCCESS", "FAILED"] } },
        data: {
          status: result.status,
          ledger: result.ledger,
          errorCode: result.error?.code ?? null,
        },
      });
    }
    const latest = await db.webhookAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    const data = response(latest);
    // Prefer a concurrently persisted terminal; otherwise report the current observation.
    if (!["SUCCESS", "FAILED"].includes(latest.status)) {
      data.status = result.status;
      if (result.status === "PENDING") delete data.error;
    }
    return data;
  }
  return response(attempt);
}

/** The database unique constraint is the cross-replica claim. No lease takeover, expiry or resend. */
export async function executeKeyedWebhook(
  deployment: Deployment,
  contractAddress: string,
  key: string,
  input: WebhookInput,
) {
  const network = env().STELLAR_NETWORK;
  if (deployment.network !== network)
    throw new AppError("VALIDATION", "Deployment is on another network");
  const keyHash = digest(WebhookIdempotencyKeySchema.parse(key));
  const requestHash = webhookRequestHash(input);
  let attempt: WebhookAttempt;
  try {
    attempt = await db.webhookAttempt.create({
      data: {
        id: randomUUID(),
        deploymentId: deployment.id,
        network,
        keyHash,
        requestHash,
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code !== "P2002") throw err;
    const original = await db.webhookAttempt.findUniqueOrThrow({
      where: {
        deploymentId_keyHash: { deploymentId: deployment.id, keyHash },
      },
    });
    if (original.requestHash !== requestHash || original.network !== network)
      throw new AppError("CONFLICT", "Idempotency-Key was already used with a different request");
    return replay(deployment, original);
  }
  try {
    await submitWebhookExecuteTx({
      contractAddress,
      ...input,
      submissionHooks: {
        beforeSend: async (txHash) => {
          const saved = await db.webhookAttempt.updateMany({
            where: { id: attempt.id, status: "PREPARING", txHash: null },
            data: { txHash, status: "SUBMITTING" },
          });
          if (saved.count !== 1)
            throw new AppError("CONFLICT", "Webhook attempt is already reserved");
        },
        afterSend: async (queued) => {
          await db.webhookAttempt.updateMany({
            where: { id: attempt.id, status: { in: mutable } },
            data: queued
              ? { status: "PENDING", acceptedAt: new Date(), errorCode: null }
              : { status: "REJECTED", errorCode: "RPC_REJECTED" },
          });
        },
      },
    });
  } catch {
    // Re-read: beforeSend may have committed even when its acknowledgement was lost.
    // A failure to read/write the attempt propagates; it must never permit another send.
    const latest = await db.webhookAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    log.warn(
      { attemptId: attempt.id, hasTxHash: Boolean(latest.txHash) },
      "keyed webhook submission interrupted; preserving original attempt",
    );
    await db.webhookAttempt.updateMany({
      where: { id: attempt.id, status: { in: mutable } },
      data: latest.txHash
        ? { status: "UNKNOWN", errorCode: "FINALITY_UNKNOWN" }
        : { status: "REJECTED", errorCode: "PREPARATION_FAILED" },
    });
  }
  return response(await db.webhookAttempt.findUniqueOrThrow({ where: { id: attempt.id } }));
}
