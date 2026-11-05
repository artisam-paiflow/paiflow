import "server-only";
import { isDeepStrictEqual } from "node:util";
import type { Deployment, Prisma, WalletControlIntent } from "@prisma/client";
import { type Account, xdr as stellarXdr } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { env, stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { lockDeployment } from "@/lib/deployments/service-work";
import { executionRequestDigest } from "@/lib/api/v1/execution-intent";
import {
  assertControlTransaction,
  parseControlTransaction,
  verifyControlTransaction,
  readControlIntent,
  reconcileControlIntent,
} from "@/lib/api/v1/control-intent";
import { submitControlIntent } from "@/lib/api/v1/control-submission";
import { getTransactionStatus } from "@/lib/api/v1/transaction-status";
import { loadPaymentAccount } from "@/lib/stellar/load-payment-account";
import { sorobanRpc } from "@/lib/stellar/client";
import { observeRpcPhase } from "@/lib/stellar/rpc-phase";
import { readMutationState } from "@/lib/stellar/mutation-state";
import { prepareMutationTransaction } from "@/lib/stellar/prepare-mutation";
import { mutationV1Args } from "@/lib/stellar/execution-v1";
import { prepareFailure } from "@/lib/api/v1/prepare-error";
import {
  MutationIntentSchema,
  MutationPrepareSchema,
  type MutationPrepare,
  type MutationIntent,
} from "./schema";
import { applyMutationValues } from "./values";
import type { ApiTokenType } from "@/lib/api/v1/auth";
import {
  assertPreparationKeyNotRefused,
  findPreparationRefusal,
  fenceRefusedPreparation,
  preparationRefusalError,
} from "./refusals";

export function mutationPreparedResponse(row: WalletControlIntent) {
  if (row.action !== "configuration.mutate" || !row.unsignedXdr)
    throw new AppError("INTERNAL", "Mutation evidence unavailable");
  const mutation = MutationIntentSchema.parse(row.mutationIntent);
  return {
    intent: row.id,
    txHash: row.txHash,
    walletAddress: row.walletAddress,
    xdr: row.unsignedXdr,
    expiresAt: new Date(Number(row.maxTime) * 1000).toISOString(),
    network: mutation.network,
    networkPassphrase: stellarPassphrase(),
    feeStroops: parseControlTransaction(row.unsignedXdr).fee,
    mutation,
  };
}
export async function findMutationRetry(deploymentId: string, keyHash: string, digest: string) {
  const row = await db.walletControlIntent.findFirst({
    where: { deploymentId, network: env().STELLAR_NETWORK, idempotencyKeyHash: keyHash },
  });
  if (!row) {
    await findPreparationRefusal(deploymentId, keyHash, digest);
    return null;
  }
  if (row.action !== "configuration.mutate" || row.requestDigest !== digest)
    throw new AppError("CONFLICT", "Idempotency-Key already identifies a different request");
  return mutationPreparedResponse(row);
}
function assertMutationBody(
  row: Pick<WalletControlIntent, "mutationIntent" | "unsignedXdr">,
  value: string,
) {
  try {
    if (stellarXdr.TransactionEnvelope.fromXDR(value, "base64").switch().name !== "envelopeTypeTx")
      throw new Error();
  } catch {
    throw new AppError("VALIDATION", "Mutation requires the exact prepared v1 envelope");
  }
  const intent = MutationIntentSchema.parse(row.mutationIntent),
    tx = parseControlTransaction(value);
  const op = tx.operations[0];
  const args = mutationV1Args(intent.nodes, intent.arguments);
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
export async function createMutationIntent(input: {
  deployment: Deployment;
  mutation: MutationIntent;
  unsignedXdr: string;
  preparationLedger: number;
  keyHash: string;
  requestDigest: string;
  assertAdmission: (tx: Prisma.TransactionClient) => Promise<void>;
  ip: string;
}) {
  const mutation = MutationIntentSchema.parse(input.mutation),
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
  };
  if (
    input.deployment.status !== "CONFIRMED" ||
    input.deployment.serviceState !== "ACTIVE" ||
    mutation.deploymentId !== input.deployment.id ||
    mutation.network !== input.deployment.network ||
    mutation.admin !== input.deployment.sourceAccount
  )
    throw new AppError("VALIDATION", "Mutation deployment, network or admin mismatch");
  assertControlTransaction(tx, binding);
  assertMutationBody(
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
  return mutationPreparedResponse(row);
}
export async function prepareMutation(
  deployment: Deployment,
  raw: MutationPrepare,
  keyHash: string,
  assertAdmission: (tx: Prisma.TransactionClient) => Promise<void>,
  ip: string,
) {
  const input = MutationPrepareSchema.parse(raw),
    requestDigest = executionRequestDigest({
      deploymentId: deployment.id,
      network: deployment.network,
      input,
    });
  const retry = await findMutationRetry(deployment.id, keyHash, requestDigest);
  if (retry) return retry;
  if (
    input.admin !== deployment.sourceAccount ||
    deployment.network !== env().STELLAR_NETWORK ||
    deployment.status !== "CONFIRMED"
  )
    throw new AppError(
      "FORBIDDEN",
      "Only the deployment developer admin may prepare configuration updates on this network",
    );
  let prepared: { mutation: MutationIntent; unsignedXdr: string; preparationLedger: number };
  let simulationStarted = false;
  try {
    let sourceAccount: Account | undefined;
    let sourceAccountFailure: { error: AppError } | undefined;
    const current = await readMutationState(deployment, async () => {
      sourceAccount = undefined;
      sourceAccountFailure = undefined;
      sourceAccount = await observeRpcPhase("mutation.account", deployment.id, () =>
        loadPaymentAccount(sorobanRpc(), input.admin),
      ).catch((error: unknown) => {
        sourceAccountFailure = { error: prepareFailure(error) };
        return undefined;
      });
    });
    if (input.admin !== current.admin)
      throw new AppError(
        "FORBIDDEN",
        "Only the deployment developer admin may authorize configuration updates",
      );
    if (current.obligations.some((status) => status.obligationsStroops !== "0"))
      throw new AppError("CONFLICT", "Unsettled path obligations block configuration changes");
    applyMutationValues(current.configurations, input.arguments);
    const mutation = MutationIntentSchema.parse({
      version: 1,
      deploymentId: deployment.id,
      network: deployment.network,
      admin: current.admin,
      rootContract: current.rootContract,
      nodes: current.nodes.map(({ nodeId, contractAddress, expectedRevision }) => ({
        nodeId,
        contractAddress,
        expectedRevision,
      })),
      arguments: input.arguments,
      artifacts: current.nodes.map(({ nodeId, contractAddress, capabilities }) => ({
        nodeId,
        contractAddress,
        wasmHash: capabilities.wasmHash,
      })),
    });
    simulationStarted = true;
    // Preserve existing authority/obligation/input refusal precedence over account failure.
    if (sourceAccountFailure) throw sourceAccountFailure.error;
    const unsignedXdr = await prepareMutationTransaction(mutation, sourceAccount);
    prepared = { mutation, unsignedXdr, preparationLedger: current.confirmedLedger };
  } catch (error) {
    if (
      error instanceof AppError &&
      ["VALIDATION", "CONFLICT", "UPSTREAM_RPC", "INSUFFICIENT_FUNDS"].includes(error.code)
    ) {
      const reason = simulationStarted ? prepareFailure(error) : error;
      const outcome = await fenceRefusedPreparation({
        deployment,
        request: input,
        keyHash,
        digest: requestDigest,
        reason,
        assertAdmission,
        ip,
      });
      if (outcome.intent) return mutationPreparedResponse(outcome.intent);
      throw preparationRefusalError(
        outcome.refusal!,
        requestDigest,
        "fresh" in outcome && outcome.fresh ? reason : undefined,
      );
    }
    // Unknown exceptions and authorization failures issue no terminal proof.
    throw simulationStarted ? prepareFailure(error) : error;
  }
  return createMutationIntent({
    deployment,
    ...prepared,
    keyHash,
    requestDigest,
    assertAdmission,
    ip,
  });
}
export async function submitMutation(input: {
  deployment: Deployment;
  intent: string;
  signedXdr: string;
  ip: string;
  tokenId?: string;
  tokenType?: ApiTokenType;
  ownerSessionId?: string;
  assertAdmission: (tx: Prisma.TransactionClient) => Promise<void>;
}) {
  const saved = await readControlIntent(input.intent, input.deployment.id, "configuration.mutate");
  verifyControlTransaction(saved, input.signedXdr);
  assertMutationBody(saved, input.signedXdr);
  return submitControlIntent({
    ...input,
    action: "configuration.mutate",
    assertEligible: async () => {
      const mutation = MutationIntentSchema.parse(saved.mutationIntent),
        current = await readMutationState(input.deployment);
      if (
        current.admin !== mutation.admin ||
        current.rootContract !== mutation.rootContract ||
        current.obligations.some((s) => s.obligationsStroops !== "0") ||
        !isDeepStrictEqual(
          current.nodes.map(({ nodeId, contractAddress, expectedRevision }) => ({
            nodeId,
            contractAddress,
            expectedRevision,
          })),
          mutation.nodes,
        ) ||
        !isDeepStrictEqual(
          current.nodes.map(({ nodeId, contractAddress, capabilities }) => ({
            nodeId,
            contractAddress,
            wasmHash: capabilities.wasmHash,
          })),
          mutation.artifacts,
        )
      )
        throw new AppError("CONFLICT", "Mutation state changed; reconcile the original intent");
      applyMutationValues(current.configurations, mutation.arguments);
    },
  });
}
export async function reconcileMutation(deployment: Deployment, id: string) {
  const intent = await reconcileControlIntent(id, deployment.id, "configuration.mutate");
  return {
    intent: intent.id,
    state: intent.state,
    transaction: await getTransactionStatus(deployment, intent.txHash),
  };
}
