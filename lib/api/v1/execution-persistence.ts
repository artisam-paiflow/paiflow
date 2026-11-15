import "server-only";
import { createHash } from "node:crypto";
import type { Deployment, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { env, stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { lockDeployment } from "@/lib/deployments/service-work";
import { REUSABLE_LIMITS } from "@/lib/flows/field-policies";
import { assertPreparationKeyNotRefused } from "@/lib/mutations/refusals";
import {
  assertControlTransaction,
  parseControlTransaction,
  verifyControlTransaction,
} from "./control-intent";
import { ExecutionArtifactsSchema, type ExecutionArtifacts } from "./execution-schema";
import {
  assertPaymentExecutionVersion,
  parsePaymentExecutionIntent,
  paymentExecutionArguments,
  type PaymentExecutionIntent,
} from "./execution-protocol";

export async function findPaymentExecutionRetryRow(
  deploymentId: string,
  keyHash: string | null,
  digest: string,
  version: 1 | 2,
) {
  if (!keyHash) return null;
  const previous = await db.walletControlIntent.findFirst({
    where: { deploymentId, network: env().STELLAR_NETWORK, idempotencyKeyHash: keyHash },
  });
  if (!previous) return null;
  if (previous.action !== "payment.execute" || previous.requestDigest !== digest)
    throw new AppError("CONFLICT", "Idempotency-Key already identifies a different execution", {
      intent: [previous.id],
      txHash: [previous.txHash],
    });
  assertPaymentExecutionVersion(previous, version);
  return previous;
}

/** Called only after simulation. Persist before returning anything for signing. */
export async function createPaymentExecutionIntent(input: {
  deployment: Pick<Deployment, "id" | "network" | "status">;
  execution: PaymentExecutionIntent;
  artifacts: ExecutionArtifacts;
  unsignedXdr: string;
  preparationLedger: number;
  keyHash: string | null;
  requestDigest: string;
  /** Optional public-hosted admission check, run under the deployment row lock. */
  assertAdmission?: (client: Prisma.TransactionClient) => Promise<void>;
  /** Server-derived public receipt evidence belongs to the same financial commit. */
  hostedAccessHash?: string;
}) {
  const hostedAccessHash =
    input.hostedAccessHash === undefined
      ? undefined
      : z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(input.hostedAccessHash);
  if (hostedAccessHash !== undefined && (!input.keyHash || !input.assertAdmission))
    throw new AppError("VALIDATION", "Hosted receipt requires scoped idempotency and admission");
  const execution = parsePaymentExecutionIntent(input.execution);
  const artifacts = ExecutionArtifactsSchema.parse(input.artifacts);
  if (
    artifacts.length !== execution.nodes.length ||
    artifacts.some(
      (artifact, index) =>
        artifact.nodeId !== execution.nodes[index]!.nodeId ||
        artifact.contractAddress !== execution.nodes[index]!.contractAddress ||
        (execution.version === 2 && artifact.wasmHash !== execution.nodes[index]!.wasmHash),
    )
  )
    throw new AppError("VALIDATION", "Execution artifacts do not match its complete contract path");
  if (
    input.deployment.network !== env().STELLAR_NETWORK ||
    input.deployment.status !== "CONFIRMED" ||
    execution.deploymentId !== input.deployment.id
  )
    throw new AppError("NOT_FOUND", "Deployment unavailable on this network");
  const tx = parseControlTransaction(input.unsignedXdr);
  const binding = {
    deploymentId: input.deployment.id,
    network: input.deployment.network,
    nodeId: execution.nodes[0]!.nodeId,
    contractAddress: execution.rootContract,
    walletAddress: execution.payer,
    action: "payment.execute",
    txHash: tx.hash().toString("hex"),
    maxTime: tx.timeBounds?.maxTime ?? "0",
    executionIntent: execution,
  };
  assertControlTransaction(tx, binding);
  const operation = tx.operations[0]!;
  if (operation.type !== "invokeHostFunction")
    throw new AppError("VALIDATION", "Invalid execution operation");
  const actualArgs = operation.func.invokeContract().args();
  const expectedArgs = paymentExecutionArguments(execution);
  if (
    actualArgs.length !== expectedArgs.length ||
    expectedArgs.some((arg, index) => !arg.toXDR().equals(actualArgs[index]!.toXDR()))
  )
    throw new AppError(
      "VALIDATION",
      "Prepared transaction does not match the reviewed execution intent",
    );
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (
    tx.signatures.length ||
    BigInt(binding.maxTime) <= now ||
    BigInt(binding.maxTime) > now + 180n
  )
    throw new AppError("VALIDATION", "Execution must be unsigned and expire within 180 seconds");
  z.number().int().positive().max(0xffff_ffff).parse(input.preparationLedger);
  if (
    execution.networkPassphraseHash !==
      createHash("sha256").update(stellarPassphrase()).digest("hex") ||
    execution.expiresAtLedger <= input.preparationLedger ||
    execution.expiresAtLedger > input.preparationLedger + REUSABLE_LIMITS.maxExecutionLedgerWindow
  )
    throw new AppError(
      "VALIDATION",
      "Execution network or ledger validity does not match preparation",
    );
  const intent = await db.$transaction(async (client) => {
    const service = await lockDeployment(client, input.deployment.id);
    if (service.serviceState !== "ACTIVE")
      throw new AppError("CONFLICT", "Deployment service is closed");
    await input.assertAdmission?.(client);
    if (input.keyHash) {
      const previous = await client.walletControlIntent.findFirst({
        where: {
          deploymentId: binding.deploymentId,
          network: binding.network,
          idempotencyKeyHash: input.keyHash,
        },
      });
      if (previous) {
        if (previous.action !== binding.action || previous.requestDigest !== input.requestDigest)
          throw new AppError(
            "CONFLICT",
            "Idempotency-Key already identifies a different execution",
            { intent: [previous.id], txHash: [previous.txHash] },
          );
        assertPaymentExecutionVersion(previous, execution.version);
        return previous;
      }
      await assertPreparationKeyNotRefused(
        client,
        binding.deploymentId,
        binding.network,
        input.keyHash,
        input.requestDigest,
      );
    }
    const previous = await client.walletControlIntent.findFirst({
      where: {
        deploymentId: binding.deploymentId,
        network: binding.network,
        action: binding.action,
        walletAddress: execution.payer,
        state: { in: ["PREPARED", "SUBMITTING"] },
      },
    });
    if (previous)
      throw new AppError(
        "CONFLICT",
        "Reconcile the previous payment before preparing another for this payer",
        { intent: [previous.id], txHash: [previous.txHash] },
      );
    return client.walletControlIntent.create({
      data: {
        ...binding,
        preparationLedger: input.preparationLedger,
        unsignedXdr: input.unsignedXdr,
        executionIntent: execution as unknown as Prisma.InputJsonValue,
        executionArtifacts: artifacts as unknown as Prisma.InputJsonValue,
        idempotencyKeyHash: input.keyHash,
        requestDigest: input.requestDigest,
        ...(hostedAccessHash === undefined ? {} : { hostedAccessHash }),
      },
    });
  });
  return intent;
}

/** A hash lookup retains the existing signedXdr-only submit shape. Every byte of
 * the transaction body/auth/resource declaration is bound, signatures excluded. */
export async function readPaymentExecutionForSubmission(
  deploymentId: string,
  signedXdr: string,
  id: string | undefined,
  version: 1 | 2,
) {
  const tx = parseControlTransaction(signedXdr);
  const row = await db.walletControlIntent.findFirst({
    where: {
      ...(id ? { id } : {}),
      deploymentId,
      network: env().STELLAR_NETWORK,
      action: "payment.execute",
      txHash: tx.hash().toString("hex"),
    },
  });
  if (!row)
    throw new AppError(
      "VALIDATION",
      "Envelope does not match an execution prepared for this deployment",
    );
  assertPaymentExecutionVersion(row, version);
  verifyControlTransaction(row, signedXdr);
  return row;
}
