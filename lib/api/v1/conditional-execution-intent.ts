import "server-only";
import type { WalletControlIntent } from "@prisma/client";
import { stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  ConditionalExecutionIntentSchema,
  type ConditionalExecutionIntent,
} from "@/lib/flows/conditional-v2";
import { assertControlTransaction, parseControlTransaction } from "./control-intent";
import {
  ConditionalExecutePreparedSchema,
  type ConditionalExecutePrepared,
} from "./conditional-execution-schema";
import {
  createPaymentExecutionIntent,
  findPaymentExecutionRetryRow,
  readPaymentExecutionForSubmission,
} from "./execution-persistence";
import { assertPaymentExecutionVersion } from "./execution-protocol";

export function conditionalExecutionPreparedResponse(
  saved: WalletControlIntent,
): ConditionalExecutePrepared {
  if (saved.action !== "payment.execute" || !saved.unsignedXdr || !saved.executionIntent)
    throw new AppError("INTERNAL", "Conditional execution preparation evidence is incomplete");
  assertPaymentExecutionVersion(saved, 2);
  const execution = ConditionalExecutionIntentSchema.parse(saved.executionIntent);
  const transaction = parseControlTransaction(saved.unsignedXdr);
  assertControlTransaction(transaction, saved);
  if (transaction.signatures.length)
    throw new AppError("INTERNAL", "Stored execution preparation must remain unsigned");
  return ConditionalExecutePreparedSchema.parse({
    intent: saved.id,
    txHash: saved.txHash,
    walletAddress: saved.walletAddress,
    xdr: saved.unsignedXdr,
    expiresAt: new Date(Number(saved.maxTime) * 1000).toISOString(),
    network: saved.network,
    networkPassphrase: stellarPassphrase(),
    execution,
  });
}
export async function findConditionalExecutionRetry(
  deploymentId: string,
  keyHash: string | null,
  digest: string,
) {
  const previous = await findPaymentExecutionRetryRow(deploymentId, keyHash, digest, 2);
  return previous ? conditionalExecutionPreparedResponse(previous) : null;
}
export async function createConditionalExecutionIntent(
  input: Omit<Parameters<typeof createPaymentExecutionIntent>[0], "execution"> & {
    execution: ConditionalExecutionIntent;
  },
) {
  const execution = ConditionalExecutionIntentSchema.parse(input.execution);
  const saved = await createPaymentExecutionIntent({ ...input, execution });
  return conditionalExecutionPreparedResponse(saved);
}
export function readConditionalExecutionForSubmission(
  deploymentId: string,
  signedXdr: string,
  id?: string,
) {
  return readPaymentExecutionForSubmission(deploymentId, signedXdr, id, 2);
}
