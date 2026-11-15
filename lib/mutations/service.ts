import "server-only";
import { isDeepStrictEqual } from "node:util";
import type { Deployment, Prisma, WalletControlIntent } from "@prisma/client";
import { type Account } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { env, stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { executionRequestDigest } from "@/lib/api/v1/execution-intent";
import {
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
import { prepareFailure } from "@/lib/api/v1/prepare-error";
import {
  MutationIntentSchema,
  MutationPrepareSchema,
  type MutationPrepare,
  type MutationIntent,
} from "./schema";
import { applyMutationValues } from "./values";
import { assertStoredMutationVersion } from "./mutation-protocol";
import { createPersistedMutationIntent, assertStoredMutationBody } from "./mutation-persistence";
import type { ApiTokenType } from "@/lib/api/v1/auth";
import {
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
  assertStoredMutationVersion(row, 1);
  return mutationPreparedResponse(row);
}
/** Exact v1 wrapper around the shared version-validated financial admission. */
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
  const mutation = MutationIntentSchema.parse(input.mutation);
  return mutationPreparedResponse(await createPersistedMutationIntent({ ...input, mutation }));
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
  assertStoredMutationVersion(saved, 1);
  verifyControlTransaction(saved, input.signedXdr);
  assertStoredMutationBody(saved, input.signedXdr);
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
  const original = await readControlIntent(id, deployment.id, "configuration.mutate");
  assertStoredMutationVersion(original, 1);
  const intent = await reconcileControlIntent(id, deployment.id, "configuration.mutate");
  return {
    intent: intent.id,
    state: intent.state,
    transaction: await getTransactionStatus(deployment, intent.txHash),
  };
}
