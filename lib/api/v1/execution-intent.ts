import "server-only";
import { createHash } from "node:crypto";
import type { Deployment, Prisma, WalletControlIntent } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { env, stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { lockDeployment } from "@/lib/deployments/service-work";
import {
  ExecutionIntentSchema,
  REUSABLE_LIMITS,
  type ExecutionIntent,
} from "@/lib/flows/field-policies";
import { executionV1Args } from "@/lib/stellar/execution-v1";
import {
  assertControlTransaction,
  parseControlTransaction,
  verifyControlTransaction,
} from "./control-intent";
import type { ExecutePrepared } from "./schema";
import { ExecutionArtifactsSchema, type ExecutionArtifacts } from "./execution-schema";

/** Hash structured validated values with deterministic object-key ordering.
 * Array order is meaningful (Split payout/rounding), so never sort arrays. */
export function executionRequestDigest(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, canonical(v)]),
      );
    return input;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export function executionIdempotencyKey(value: string | null): string | null {
  if (value === null) return null;
  const key = z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/)
    .parse(value);
  return createHash("sha256").update(key).digest("hex");
}

export function executionPreparedResponse(intent: WalletControlIntent): ExecutePrepared {
  if (intent.action !== "payment.execute" || !intent.unsignedXdr || !intent.executionIntent)
    throw new AppError("INTERNAL", "Execution preparation evidence is incomplete");
  const execution = ExecutionIntentSchema.parse(intent.executionIntent);
  return {
    intent: intent.id,
    txHash: intent.txHash,
    walletAddress: intent.walletAddress,
    xdr: intent.unsignedXdr,
    expiresAt: new Date(Number(intent.maxTime) * 1000).toISOString(),
    network: z.enum(["testnet", "mainnet"]).parse(intent.network),
    networkPassphrase: stellarPassphrase(),
    execution,
  };
}

export async function findExecutionRetry(
  deploymentId: string,
  keyHash: string | null,
  digest: string,
) {
  if (!keyHash) return null;
  const previous = await db.walletControlIntent.findFirst({
    where: { deploymentId, network: env().STELLAR_NETWORK, idempotencyKeyHash: keyHash },
  });
  if (!previous) return null;
  if (previous.action !== "payment.execute" || previous.requestDigest !== digest)
    throw new AppError("CONFLICT", "Idempotency-Key already identifies a different execution");
  return executionPreparedResponse(previous);
}

/** Called only after simulation. Persist before returning anything for signing. */
export async function createExecutionIntent(input: {
  deployment: Pick<Deployment, "id" | "network" | "status">;
  execution: ExecutionIntent;
  artifacts: ExecutionArtifacts;
  unsignedXdr: string;
  preparationLedger: number;
  keyHash: string | null;
  requestDigest: string;
}) {
  const execution = ExecutionIntentSchema.parse(input.execution);
  const artifacts = ExecutionArtifactsSchema.parse(input.artifacts);
  if (
    artifacts.length !== execution.nodes.length ||
    artifacts.some(
      (artifact, index) =>
        artifact.nodeId !== execution.nodes[index]!.nodeId ||
        artifact.contractAddress !== execution.nodes[index]!.contractAddress,
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
  };
  assertControlTransaction(tx, binding);
  const operation = tx.operations[0]!;
  if (operation.type !== "invokeHostFunction")
    throw new AppError("VALIDATION", "Invalid execution operation");
  const actualArgs = operation.func.invokeContract().args();
  const expectedArgs = executionV1Args(execution);
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
          );
        return previous;
      }
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
      },
    });
  });
  return executionPreparedResponse(intent);
}

/** A hash lookup retains the existing signedXdr-only submit shape. Every byte of
 * the transaction body/auth/resource declaration is bound, signatures excluded. */
export async function readExecutionForSubmission(
  deploymentId: string,
  signedXdr: string,
  id?: string,
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
  verifyControlTransaction(row, signedXdr);
  return row;
}
