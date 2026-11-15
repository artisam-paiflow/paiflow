import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Deployment, Prisma, WalletControlIntent } from "@prisma/client";
import type { Account } from "@stellar/stellar-sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { env, stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
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
import type { ApiTokenType } from "@/lib/api/v1/auth";
import { prepareFailure } from "@/lib/api/v1/prepare-error";
import {
  ConditionalMutationIntentSchema,
  conditionalMutationArgumentsSchema,
  type ConditionalMutationArguments,
  type ConditionalMutationIntent,
} from "@/lib/flows/conditional-v2";
import { readConditionalMutationState } from "@/lib/stellar/conditional-mutation-state";
import { prepareConditionalMutationTransaction } from "@/lib/stellar/prepare-conditional-mutation";
import { loadPaymentAccount } from "@/lib/stellar/load-payment-account";
import { sorobanRpc } from "@/lib/stellar/client";
import { observeRpcPhase } from "@/lib/stellar/rpc-phase";
import {
  ConditionalMutationPrepareSchema,
  ConditionalMutationPreparedSchema,
  type ConditionalMutationPrepare,
  type ConditionalMutationState,
} from "./conditional-schema";
import { assertStoredMutationVersion } from "./mutation-protocol";
import { createPersistedMutationIntent, assertStoredMutationBody } from "./mutation-persistence";
import {
  findPreparationRefusal,
  fenceRefusedPreparation,
  preparationRefusalError,
} from "./refusals";

export function conditionalMutationPreparedResponse(saved: WalletControlIntent) {
  if (saved.action !== "configuration.mutate" || !saved.unsignedXdr)
    throw new AppError("INTERNAL", "Conditional mutation evidence unavailable");
  assertStoredMutationVersion(saved, 2);
  const mutation = ConditionalMutationIntentSchema.parse(saved.mutationIntent);
  const transaction = parseControlTransaction(saved.unsignedXdr);
  assertControlTransaction(transaction, saved);
  assertStoredMutationBody(saved, saved.unsignedXdr);
  if (transaction.signatures.length)
    throw new AppError("INTERNAL", "Stored mutation must remain unsigned");
  return ConditionalMutationPreparedSchema.parse({
    intent: saved.id,
    txHash: saved.txHash,
    walletAddress: saved.walletAddress,
    xdr: saved.unsignedXdr,
    expiresAt: new Date(Number(saved.maxTime) * 1000).toISOString(),
    network: saved.network,
    networkPassphrase: stellarPassphrase(),
    feeStroops: transaction.fee,
    mutation,
  });
}
export async function findConditionalMutationRetry(
  deploymentId: string,
  keyHash: string,
  digest: string,
) {
  const previous = await db.walletControlIntent.findFirst({
    where: { deploymentId, network: env().STELLAR_NETWORK, idempotencyKeyHash: keyHash },
  });
  if (!previous) {
    await findPreparationRefusal(deploymentId, keyHash, digest, 2);
    return null;
  }
  if (previous.action !== "configuration.mutate" || previous.requestDigest !== digest)
    throw new AppError("CONFLICT", "Idempotency-Key already identifies a different request", {
      intent: [previous.id],
      txHash: [previous.txHash],
    });
  return conditionalMutationPreparedResponse(previous);
}
export async function createConditionalMutationIntent(
  input: Omit<Parameters<typeof createPersistedMutationIntent>[0], "mutation"> & {
    mutation: ConditionalMutationIntent;
  },
) {
  const mutation = ConditionalMutationIntentSchema.parse(input.mutation);
  return conditionalMutationPreparedResponse(
    await createPersistedMutationIntent({ ...input, mutation }),
  );
}
function validateCurrentGroup(
  current: ConditionalMutationState,
  arguments_: ConditionalMutationArguments,
) {
  if (current.statuses.some((status) => status.obligationsStroops !== "0"))
    throw new AppError("CONFLICT", "Unsettled graph obligations block configuration changes");
  for (const change of arguments_.changes) {
    const binding = current.nodes.find((node) => node.nodeId === change.nodeId);
    if (binding && binding.expectedRevision !== change.expectedRevision)
      throw new AppError("CONFLICT", "Configuration revision changed", {
        expectedRevision: [binding.expectedRevision],
      });
  }
  const result = conditionalMutationArgumentsSchema(current.definition, current.nodes).safeParse(
    arguments_,
  );
  if (!result.success)
    throw new AppError("VALIDATION", "Mutation violates declared configuration policy", {
      arguments: result.error.issues.map((issue) => issue.message),
    });
  return result.data;
}
export async function prepareConditionalMutation(
  deployment: Deployment,
  raw: ConditionalMutationPrepare,
  keyHash: string,
  assertAdmission: (tx: Prisma.TransactionClient) => Promise<void>,
  ip: string,
) {
  const input = ConditionalMutationPrepareSchema.parse(raw);
  const requestDigest = executionRequestDigest({
    version: 2,
    deploymentId: deployment.id,
    network: deployment.network,
    input,
  });
  const retry = await findConditionalMutationRetry(deployment.id, keyHash, requestDigest);
  if (retry) return retry;
  if (
    input.admin !== deployment.sourceAccount ||
    deployment.network !== env().STELLAR_NETWORK ||
    deployment.status !== "CONFIRMED"
  )
    throw new AppError(
      "FORBIDDEN",
      "Only the immutable deployment admin may prepare configuration updates on this network",
    );
  let prepared: {
    mutation: ConditionalMutationIntent;
    unsignedXdr: string;
    preparationLedger: number;
  };
  let simulationStarted = false;
  try {
    let sourceAccount: Account | undefined;
    let accountFailure: { error: AppError } | undefined;
    const current = await readConditionalMutationState(deployment, async () => {
      sourceAccount = undefined;
      accountFailure = undefined;
      sourceAccount = await observeRpcPhase("mutation.account", deployment.id, () =>
        loadPaymentAccount(sorobanRpc(), input.admin),
      ).catch((error: unknown) => {
        accountFailure = { error: prepareFailure(error) };
        return undefined;
      });
    });
    if (input.admin !== current.admin)
      throw new AppError("FORBIDDEN", "Only the immutable deployment admin may authorize changes");
    const arguments_ = validateCurrentGroup(current, input.arguments);
    const mutation = ConditionalMutationIntentSchema.parse({
      version: 2,
      deploymentId: deployment.id,
      networkPassphraseHash: createHash("sha256").update(stellarPassphrase()).digest("hex"),
      rootContract: current.nodes[0]!.contractAddress,
      admin: current.admin,
      definition: current.definition,
      nodes: current.nodes,
      arguments: arguments_,
    });
    simulationStarted = true;
    if (accountFailure) throw accountFailure.error;
    const unsignedXdr = await prepareConditionalMutationTransaction(mutation, sourceAccount);
    prepared = { mutation, unsignedXdr, preparationLedger: current.confirmedLedger };
  } catch (caught) {
    const error =
      caught instanceof z.ZodError
        ? new AppError("VALIDATION", "Mutation violates declared configuration policy", {
            arguments: caught.issues.map((issue) => issue.message),
          })
        : caught;
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
      if (outcome.intent) return conditionalMutationPreparedResponse(outcome.intent);
      throw preparationRefusalError(
        outcome.refusal!,
        requestDigest,
        "fresh" in outcome && outcome.fresh ? reason : undefined,
      );
    }
    throw simulationStarted ? prepareFailure(error) : error;
  }
  return createConditionalMutationIntent({
    deployment,
    ...prepared,
    keyHash,
    requestDigest,
    assertAdmission,
    ip,
  });
}
export async function submitConditionalMutation(input: {
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
  assertStoredMutationVersion(saved, 2);
  verifyControlTransaction(saved, input.signedXdr);
  assertStoredMutationBody(saved, input.signedXdr);
  return submitControlIntent({
    ...input,
    action: "configuration.mutate",
    assertEligible: async () => {
      const mutation = ConditionalMutationIntentSchema.parse(saved.mutationIntent);
      const current = await readConditionalMutationState(input.deployment);
      if (
        current.admin !== mutation.admin ||
        current.nodes[0]?.contractAddress !== mutation.rootContract ||
        !isDeepStrictEqual(current.nodes, mutation.nodes) ||
        !isDeepStrictEqual(current.definition, mutation.definition) ||
        current.statuses.some((status) => status.obligationsStroops !== "0")
      )
        throw new AppError("CONFLICT", "Mutation state changed; reconcile the original intent", {
          intent: [saved.id],
          txHash: [saved.txHash],
        });
      validateCurrentGroup(current, mutation.arguments);
    },
  });
}
export async function reconcileConditionalMutation(deployment: Deployment, id: string) {
  const original = await readControlIntent(id, deployment.id, "configuration.mutate");
  assertStoredMutationVersion(original, 2);
  const intent = await reconcileControlIntent(id, deployment.id, "configuration.mutate");
  return {
    intent: intent.id,
    state: intent.state,
    transaction: await getTransactionStatus(deployment, intent.txHash),
  };
}
