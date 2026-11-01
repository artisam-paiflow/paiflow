import "server-only";
import type { Deployment, MutationPreparationRefusal, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { lockDeployment } from "@/lib/deployments/service-work";
import { MutationPreparationRefusalSchema, type MutationPrepare } from "./schema";

export function preparationRefusalError(
  row: MutationPreparationRefusal,
  digest: string,
  cause?: AppError,
) {
  if (row.requestDigest !== digest)
    return new AppError(
      "CONFLICT",
      "Idempotency-Key already identifies a different refused request",
    );
  const proof = MutationPreparationRefusalSchema.parse({
    version: 1,
    outcome: "NOT_ADMITTED",
    refusalId: row.id,
    deploymentId: row.deploymentId,
    network: row.network,
    admin: row.admin,
    idempotencyKeyHash: row.idempotencyKeyHash,
    requestDigest: row.requestDigest,
    refusedAt: row.createdAt.toISOString(),
    reasonCode: row.reasonCode,
  });
  return new AppError(
    proof.reasonCode,
    cause?.message ??
      "This original preparation was durably refused before admission. Verify its refusal, then review current terms before a new preparation.",
    { ...cause?.fields, preparationRefusal: [JSON.stringify(proof)] },
    cause?.details,
    cause?.retryAfterSeconds,
  );
}
/** All shared keyed-control creators call this under the deployment row lock. */
export async function assertPreparationKeyNotRefused(
  client: Prisma.TransactionClient,
  deploymentId: string,
  network: string,
  keyHash: string,
  digest: string,
) {
  const row = await client.mutationPreparationRefusal.findUnique({
    where: {
      deploymentId_network_idempotencyKeyHash: {
        deploymentId,
        network,
        idempotencyKeyHash: keyHash,
      },
    },
  });
  if (row) throw preparationRefusalError(row, digest);
}
export async function findPreparationRefusal(
  deploymentId: string,
  keyHash: string,
  digest: string,
) {
  const row = await db.mutationPreparationRefusal.findUnique({
    where: {
      deploymentId_network_idempotencyKeyHash: {
        deploymentId,
        network: env().STELLAR_NETWORK,
        idempotencyKeyHash: keyHash,
      },
    },
  });
  if (row) throw preparationRefusalError(row, digest);
}
/** A read/simulation failure alone proves nothing. This transaction fences every
 * late creator before issuing non-admission evidence; admitted intent always wins. */
export async function fenceRefusedPreparation(input: {
  deployment: Deployment;
  request: MutationPrepare;
  keyHash: string;
  digest: string;
  reason: AppError;
  assertAdmission: (client: Prisma.TransactionClient) => Promise<void>;
  ip: string;
}) {
  return db.$transaction(async (client) => {
    const service = await lockDeployment(client, input.deployment.id);
    if (service.serviceState !== "ACTIVE")
      throw new AppError(
        "CONFLICT",
        "Deployment service is closed; original preparation outcome must be retained",
      );
    await input.assertAdmission(client);
    const existing = await client.walletControlIntent.findFirst({
      where: {
        deploymentId: input.deployment.id,
        network: input.deployment.network,
        idempotencyKeyHash: input.keyHash,
      },
    });
    if (existing) {
      if (existing.action !== "configuration.mutate" || existing.requestDigest !== input.digest)
        throw new AppError("CONFLICT", "Idempotency-Key already identifies a different request");
      return { intent: existing };
    }
    const old = await client.mutationPreparationRefusal.findUnique({
      where: {
        deploymentId_network_idempotencyKeyHash: {
          deploymentId: input.deployment.id,
          network: input.deployment.network,
          idempotencyKeyHash: input.keyHash,
        },
      },
    });
    if (old) return { refusal: old, fresh: false };
    const refusal = await client.mutationPreparationRefusal.create({
      data: {
        deploymentId: input.deployment.id,
        network: input.deployment.network,
        idempotencyKeyHash: input.keyHash,
        requestDigest: input.digest,
        admin: input.request.admin,
        request: input.request as unknown as Prisma.InputJsonValue,
        reasonCode: input.reason.code,
      },
    });
    await client.auditLog.create({
      data: {
        action: "CONFIGURATION_PREPARATION_REFUSED",
        userId: input.deployment.ownerId,
        ip: input.ip,
        metadata: {
          deploymentId: input.deployment.id,
          refusalId: refusal.id,
          reasonCode: input.reason.code,
          admin: input.request.admin,
        },
      },
    });
    return { refusal, fresh: true };
  });
}
