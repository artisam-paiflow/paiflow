import "server-only";
import { createHash } from "node:crypto";
import type { Deployment, Prisma, WalletControlIntent } from "@prisma/client";
import { xdr as stellarXdr } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { env, stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { lockDeployment } from "@/lib/deployments/service-work";
import { assertControlTransaction, parseControlTransaction } from "@/lib/api/v1/control-intent";
import { assertPreparationKeyNotRefused } from "./refusals";
import {
  assertStoredMutationVersion,
  parseStoredMutationIntent,
  storedMutationArguments,
  type StoredMutationIntent,
} from "./mutation-protocol";

export function assertStoredMutationBody(
  row: Pick<WalletControlIntent, "mutationIntent" | "unsignedXdr">,
  value: string,
) {
  try {
    if (stellarXdr.TransactionEnvelope.fromXDR(value, "base64").switch().name !== "envelopeTypeTx")
      throw new Error();
  } catch {
    throw new AppError("VALIDATION", "Mutation requires the exact prepared envelope");
  }
  const intent = parseStoredMutationIntent(row.mutationIntent),
    tx = parseControlTransaction(value);
  const op = tx.operations[0];
  const args = storedMutationArguments(intent);
  if (
    op?.type !== "invokeHostFunction" ||
    op.func.switch().name !== "hostFunctionTypeInvokeContract" ||
    op.func.invokeContract().args().length !== args.length ||
    args.some((arg, i) => !arg.toXDR().equals(op.func.invokeContract().args()[i]!.toXDR()))
  )
    throw new AppError("VALIDATION", "Mutation arguments differ from the reviewed intent");
  if (row.unsignedXdr && !parseControlTransaction(row.unsignedXdr).hash().equals(tx.hash()))
    throw new AppError("VALIDATION", "Mutation transaction body differs from its preparation");
}
export async function createPersistedMutationIntent(input: {
  deployment: Deployment;
  mutation: StoredMutationIntent;
  unsignedXdr: string;
  preparationLedger: number;
  keyHash: string;
  requestDigest: string;
  assertAdmission: (tx: Prisma.TransactionClient) => Promise<void>;
  ip: string;
}) {
  const mutation = parseStoredMutationIntent(input.mutation),
    tx = parseControlTransaction(input.unsignedXdr);
  const binding = {
    deploymentId: input.deployment.id,
    network: input.deployment.network,
    nodeId: mutation.nodes[0]!.nodeId,
    contractAddress: mutation.rootContract,
    walletAddress: mutation.admin,
    action: "configuration.mutate",
    txHash: tx.hash().toString("hex"),
    maxTime: tx.timeBounds?.maxTime ?? "0",
    mutationIntent: mutation,
  };
  if (
    input.deployment.status !== "CONFIRMED" ||
    input.deployment.serviceState !== "ACTIVE" ||
    mutation.deploymentId.toLowerCase() !== input.deployment.id.toLowerCase() ||
    (mutation.version === 1
      ? mutation.network !== input.deployment.network
      : mutation.networkPassphraseHash !==
        createHash("sha256").update(stellarPassphrase()).digest("hex")) ||
    input.deployment.network !== env().STELLAR_NETWORK ||
    mutation.admin !== input.deployment.sourceAccount
  )
    throw new AppError("VALIDATION", "Mutation deployment, network or admin mismatch");
  assertControlTransaction(tx, binding);
  assertStoredMutationBody(
    { mutationIntent: mutation as unknown as Prisma.JsonValue, unsignedXdr: input.unsignedXdr },
    input.unsignedXdr,
  );
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (
    tx.signatures.length ||
    BigInt(binding.maxTime) <= now ||
    BigInt(binding.maxTime) > now + 180n ||
    !Number.isInteger(input.preparationLedger) ||
    input.preparationLedger <= 0
  )
    throw new AppError(
      "VALIDATION",
      "Mutation must be unsigned, simulated and expire within 180 seconds",
    );
  const row = await db.$transaction(async (client) => {
    const service = await lockDeployment(client, input.deployment.id);
    if (service.serviceState !== "ACTIVE")
      throw new AppError("CONFLICT", "Deployment service is closed");
    await input.assertAdmission(client);
    const previous = await client.walletControlIntent.findFirst({
      where: {
        deploymentId: binding.deploymentId,
        network: binding.network,
        idempotencyKeyHash: input.keyHash,
      },
    });
    if (previous) {
      if (previous.action !== binding.action || previous.requestDigest !== input.requestDigest)
        throw new AppError("CONFLICT", "Idempotency-Key already identifies a different request");
      assertStoredMutationVersion(previous, mutation.version);
      return previous;
    }
    await assertPreparationKeyNotRefused(
      client,
      binding.deploymentId,
      binding.network,
      input.keyHash,
      input.requestDigest,
    );
    const unresolved = await client.walletControlIntent.findFirst({
      where: {
        deploymentId: binding.deploymentId,
        network: binding.network,
        action: binding.action,
        state: { in: ["PREPARED", "SUBMITTING"] },
      },
    });
    if (unresolved)
      throw new AppError("CONFLICT", "Reconcile the original mutation before preparing another", {
        intent: [unresolved.id],
        txHash: [unresolved.txHash],
      });
    const saved = await client.walletControlIntent.create({
      data: {
        ...binding,
        unsignedXdr: input.unsignedXdr,
        preparationLedger: input.preparationLedger,
        mutationIntent: mutation as unknown as Prisma.InputJsonValue,
        idempotencyKeyHash: input.keyHash,
        requestDigest: input.requestDigest,
      },
    });
    await client.auditLog.create({
      data: {
        action: "CONFIGURATION_MUTATION_PREPARED",
        userId: input.deployment.ownerId,
        ip: input.ip,
        metadata: {
          deploymentId: binding.deploymentId,
          intent: saved.id,
          txHash: binding.txHash,
          admin: mutation.admin,
        },
      },
    });
    return saved;
  });
  return row;
}
