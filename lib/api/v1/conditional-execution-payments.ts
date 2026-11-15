import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Account } from "@stellar/stellar-sdk";
import type { Deployment, Prisma } from "@prisma/client";
import { stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  ConditionalExecutionIntentSchema,
  conditionalExecutionArgumentsSchema,
  selectConditionalBranch,
} from "@/lib/flows/conditional-v2";
import { REUSABLE_LIMITS } from "@/lib/flows/field-policies";
import {
  readConditionalExecutionState,
  readConditionalExecutionStateForReview,
} from "@/lib/stellar/conditional-execution-state";
import { prepareConditionalExecutionTransaction } from "@/lib/stellar/prepare-conditional-execution";
import { sorobanRpc } from "@/lib/stellar/client";
import { loadPaymentAccount } from "@/lib/stellar/load-payment-account";
import { observeRpcPhase } from "@/lib/stellar/rpc-phase";
import { interactiveRpcBudgetExpired } from "@/lib/stellar/interactive-rpc-budget";
import {
  ConditionalExecutePrepareSchema,
  type ConditionalExecutePrepare,
  type SupportedConditionalExecutionState,
} from "./conditional-execution-schema";
import {
  createConditionalExecutionIntent,
  findConditionalExecutionRetry,
  readConditionalExecutionForSubmission,
} from "./conditional-execution-intent";
import { executionRequestDigest } from "./execution-intent";
import { assertPaymentExecutionVersion } from "./execution-protocol";
import { submitControlIntent } from "./control-submission";
import { readControlIntent, recordControlFinality } from "./control-intent";
import { waitForFinal } from "./execute";
import { getTransactionStatus } from "./transaction-status";
import { acquireWaitSlot } from "./wait-slots";
import { apiTokenKey, type ApiTokenType } from "./auth";
import type { TransactionStatus } from "./schema";
import { prepareFailure } from "./prepare-error";

export async function prepareConditionalExecutionPayment(
  deployment: Deployment,
  raw: ConditionalExecutePrepare,
  keyHash: string | null,
  assertAdmission?: (client: Prisma.TransactionClient) => Promise<void>,
  hostedAccessHash?: string,
  reviewState?: (state: SupportedConditionalExecutionState) => void,
) {
  const input = ConditionalExecutePrepareSchema.parse(raw);
  const requestDigest = executionRequestDigest({
    version: 2,
    deploymentId: deployment.id,
    network: deployment.network,
    input,
  });
  const retry = await findConditionalExecutionRetry(deployment.id, keyHash, requestDigest);
  if (retry) return retry;
  let sourceAccount: Account | undefined;
  let sourceAccountFailure: { error: AppError } | undefined;
  const options = {
    finalRead: async () => {
      sourceAccount = undefined;
      sourceAccountFailure = undefined;
      sourceAccount = await observeRpcPhase("payment.account", deployment.id, () =>
        loadPaymentAccount(sorobanRpc(), input.from),
      ).catch((error: unknown) => {
        sourceAccountFailure = { error: prepareFailure(error) };
        return undefined;
      });
    },
  };
  const observation = reviewState
    ? await readConditionalExecutionStateForReview(deployment, options)
    : undefined;
  const current =
    observation?.current ?? (await readConditionalExecutionState(deployment, options));
  if (!current.supported)
    throw new AppError("VALIDATION", "This deployment does not support conditional execution");
  const arguments_ = conditionalExecutionArgumentsSchema(current.definition, input.amount).parse(
    input.arguments,
  );
  const execution = ConditionalExecutionIntentSchema.parse({
    version: 2,
    deploymentId: deployment.id,
    networkPassphraseHash: createHash("sha256").update(stellarPassphrase()).digest("hex"),
    rootContract: current.nodes[0]!.contractAddress,
    assetContract: current.definition.assetContract,
    payer: input.from,
    amountStroops: input.amount,
    nonce: randomBytes(32).toString("hex"),
    expiresAtLedger: Math.min(
      0xffff_ffff,
      current.confirmedLedger + REUSABLE_LIMITS.maxExecutionLedgerWindow,
    ),
    definition: current.definition,
    nodes: current.nodes,
    arguments: arguments_,
    ...selectConditionalBranch(current.definition, input.amount),
  });
  if (sourceAccountFailure) throw sourceAccountFailure.error;
  const { xdr } = await prepareConditionalExecutionTransaction(execution, sourceAccount).catch(
    (error: unknown) => {
      throw prepareFailure(error);
    },
  );
  const prepared = await createConditionalExecutionIntent({
    deployment,
    execution,
    artifacts: current.nodes.map(({ nodeId, contractAddress, wasmHash }) => ({
      nodeId,
      contractAddress,
      wasmHash,
    })),
    unsignedXdr: xdr,
    preparationLedger: current.confirmedLedger,
    keyHash,
    requestDigest,
    assertAdmission,
    hostedAccessHash,
  });
  if (reviewState) {
    if (!observation?.refresh)
      throw new AppError("INTERNAL", "Missing verified conditional payment review");
    reviewState(await observation.refresh());
  }
  return prepared;
}

/** Runs before first send only. Reconciliation always retains its original hash. */
export async function assertConditionalExecutionEligible(deployment: Deployment, id: string) {
  const saved = await readControlIntent(id, deployment.id, "payment.execute");
  assertPaymentExecutionVersion(saved, 2);
  const execution = ConditionalExecutionIntentSchema.parse(saved.executionIntent);
  const current = await readConditionalExecutionState(deployment);
  if (
    !current.supported ||
    current.nodes[0]?.contractAddress !== execution.rootContract ||
    !isDeepStrictEqual(current.nodes, execution.nodes) ||
    !isDeepStrictEqual(current.definition, execution.definition) ||
    !isDeepStrictEqual(
      current.nodes.map(({ nodeId, contractAddress, wasmHash }) => ({
        nodeId,
        contractAddress,
        wasmHash,
      })),
      saved.executionArtifacts,
    )
  )
    throw new AppError(
      "CONFLICT",
      "Execution configuration changed; reconcile this preparation before preparing and signing again",
      { intent: [saved.id], txHash: [saved.txHash] },
    );
  conditionalExecutionArgumentsSchema(current.definition, execution.amountStroops).parse(
    execution.arguments,
  );
  const selected = selectConditionalBranch(current.definition, execution.amountStroops);
  if (
    selected.selectedBranch !== execution.selectedBranch ||
    selected.amountAtConditionStroops !== execution.amountAtConditionStroops
  )
    throw new AppError("CONFLICT", "Conditional route differs from the original reviewed payment", {
      intent: [saved.id],
      txHash: [saved.txHash],
    });
}

export async function submitConditionalExecutionPayment(input: {
  deployment: Deployment;
  tokenId?: string;
  tokenType?: ApiTokenType;
  signedXdr: string;
  intent?: string;
  wait: boolean;
  ip: string;
  assertAdmission?: (client: Prisma.TransactionClient) => Promise<void>;
}): Promise<TransactionStatus> {
  const saved = await readConditionalExecutionForSubmission(
    input.deployment.id,
    input.signedXdr,
    input.intent,
  );
  const result = await submitControlIntent({
    ...input,
    intent: saved.id,
    action: "payment.execute",
    assertEligible: () => assertConditionalExecutionEligible(input.deployment, saved.id),
  });
  if (result.status !== "PENDING" || !input.wait || interactiveRpcBudgetExpired()) return result;
  const slot = await acquireWaitSlot(
    input.tokenId
      ? apiTokenKey(input.tokenId, input.tokenType)
      : `public-execution:${input.deployment.id}:${saved.walletAddress}`,
  );
  if (!slot) return result;
  try {
    const got = await waitForFinal(saved.txHash);
    if (got.status === "SUCCESS" || got.status === "FAILED") {
      await recordControlFinality(input.deployment.id, saved.txHash, got.status, got.ledger);
      return getTransactionStatus(input.deployment, saved.txHash);
    }
  } catch {
    // The durable original remains admitted; optional waiting cannot authorize replacement.
  } finally {
    await slot.release();
  }
  return result;
}
