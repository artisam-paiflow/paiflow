import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Deployment } from "@prisma/client";
import { stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  ExecutionIntentSchema,
  REUSABLE_LIMITS,
  StroopsSchema,
  executionArgumentsSchema,
} from "@/lib/flows/field-policies";
import { readExecutionState } from "@/lib/stellar/execution-state";
import { prepareExecutionTransaction } from "@/lib/stellar/prepare-execution";
import { interactiveRpcBudgetExpired } from "@/lib/stellar/interactive-rpc-budget";
import { assertExecutionValues } from "./execution-values";
import {
  createExecutionIntent,
  executionRequestDigest,
  findExecutionRetry,
  readExecutionForSubmission,
} from "./execution-intent";
import { submitControlIntent } from "./control-submission";
import { readControlIntent, recordControlFinality } from "./control-intent";
import { waitForFinal } from "./execute";
import { getTransactionStatus } from "./transaction-status";
import { acquireWaitSlot } from "./wait-slots";
import { apiTokenKey, type ApiTokenType } from "./auth";
import type { ExecutePrepare, TransactionStatus } from "./schema";
import { ExecutionArtifactsSchema } from "./execution-schema";
import { prepareFailure } from "./prepare-error";

export async function prepareExecutionPayment(
  deployment: Deployment,
  input: ExecutePrepare,
  keyHash: string | null,
) {
  const requestDigest = executionRequestDigest({
    deploymentId: deployment.id,
    network: deployment.network,
    input,
  });
  const retry = await findExecutionRetry(deployment.id, keyHash, requestDigest);
  if (retry) return retry;
  const current = await readExecutionState(deployment);
  if (!current.supported)
    throw new AppError("VALIDATION", "This deployment does not support execution parameters");
  const amountStroops = StroopsSchema.parse(input.amount);
  if (BigInt(amountStroops) < BigInt(current.minAmountStroops))
    throw new AppError("VALIDATION", "Amount is below the configured deposit minimum", {
      amount: ["Deposit minimum is not met"],
    });
  const arguments_ = executionArgumentsSchema(current.policies).parse(
    input.arguments ?? { version: 1, inputs: [] },
  );
  assertExecutionValues(current.policies, current.configurations, arguments_, amountStroops);
  const execution = ExecutionIntentSchema.parse({
    version: 1,
    deploymentId: deployment.id,
    networkPassphraseHash: createHash("sha256").update(stellarPassphrase()).digest("hex"),
    rootContract: current.rootContract,
    assetContract: current.assetContract,
    payer: input.from,
    amountStroops,
    nonce: randomBytes(32).toString("hex"),
    expiresAtLedger: Math.min(
      0xffff_ffff,
      current.confirmedLedger + REUSABLE_LIMITS.maxExecutionLedgerWindow,
    ),
    nodes: current.nodes.map(({ nodeId, contractAddress, expectedRevision }) => ({
      nodeId,
      contractAddress,
      expectedRevision,
    })),
    arguments: arguments_,
  });
  const { xdr } = await prepareExecutionTransaction(execution).catch((error: unknown) => {
    throw prepareFailure(error);
  });
  return createExecutionIntent({
    deployment,
    execution,
    artifacts: current.nodes.map(({ nodeId, contractAddress, capabilities }) => ({
      nodeId,
      contractAddress,
      wasmHash: capabilities.wasmHash,
    })),
    unsignedXdr: xdr,
    preparationLedger: current.confirmedLedger,
    keyHash,
    requestDigest,
  });
}

/** Checks happen before first send; finality retries use the original evidence
 * even when time/configuration has moved on. Chain checks protect the read/send race. */
export async function assertExecutionEligible(deployment: Deployment, id: string) {
  const saved = await readControlIntent(id, deployment.id, "payment.execute");
  const execution = ExecutionIntentSchema.parse(saved.executionIntent);
  const artifacts = ExecutionArtifactsSchema.parse(saved.executionArtifacts);
  const current = await readExecutionState(deployment);
  if (
    !current.supported ||
    current.assetContract !== execution.assetContract ||
    !isDeepStrictEqual(
      current.nodes.map(({ nodeId, contractAddress, capabilities }) => ({
        nodeId,
        contractAddress,
        wasmHash: capabilities.wasmHash,
      })),
      artifacts,
    ) ||
    current.rootContract !== execution.rootContract ||
    !isDeepStrictEqual(
      current.nodes.map(({ nodeId, contractAddress, expectedRevision }) => ({
        nodeId,
        contractAddress,
        expectedRevision,
      })),
      execution.nodes,
    )
  )
    throw new AppError(
      "CONFLICT",
      "Execution configuration changed; reconcile this preparation before preparing and signing again",
    );
  const args = executionArgumentsSchema(current.policies).parse(execution.arguments);
  assertExecutionValues(current.policies, current.configurations, args, execution.amountStroops);
}

export async function submitExecutionPayment(input: {
  deployment: Deployment;
  /** Public hosted callers omit credentials after their explicit opt-in guard. */
  tokenId?: string;
  tokenType?: ApiTokenType;
  signedXdr: string;
  intent?: string;
  wait: boolean;
  ip: string;
}): Promise<TransactionStatus> {
  const saved = await readExecutionForSubmission(
    input.deployment.id,
    input.signedXdr,
    input.intent,
  );
  const result = await submitControlIntent({
    ...input,
    intent: saved.id,
    action: "payment.execute",
    assertEligible: () => assertExecutionEligible(input.deployment, saved.id),
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
    // Accepted identity remains recoverable. Optional waiting must not turn an
    // already accepted payment into a replacement prompt after an RPC timeout.
  } finally {
    await slot.release();
  }
  return result;
}
