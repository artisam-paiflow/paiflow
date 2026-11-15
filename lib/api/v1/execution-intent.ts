import "server-only";
import { createHash } from "node:crypto";
import type { Deployment, Prisma, WalletControlIntent } from "@prisma/client";
import { z } from "zod";
import { stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { ExecutionIntentSchema, type ExecutionIntent } from "@/lib/flows/field-policies";
import type { ExecutePrepared } from "./schema";
import type { ExecutionArtifacts } from "./execution-schema";
import {
  createPaymentExecutionIntent,
  findPaymentExecutionRetryRow,
  readPaymentExecutionForSubmission,
} from "./execution-persistence";
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
  const previous = await findPaymentExecutionRetryRow(deploymentId, keyHash, digest, 1);
  return previous ? executionPreparedResponse(previous) : null;
}
/** Public v1 wrapper; the shared persistence service never reinterprets v1 input. */
export async function createExecutionIntent(input: {
  deployment: Pick<Deployment, "id" | "network" | "status">;
  execution: ExecutionIntent;
  artifacts: ExecutionArtifacts;
  unsignedXdr: string;
  preparationLedger: number;
  keyHash: string | null;
  requestDigest: string;
  assertAdmission?: (client: Prisma.TransactionClient) => Promise<void>;
  hostedAccessHash?: string;
}) {
  const execution = ExecutionIntentSchema.parse(input.execution);
  return executionPreparedResponse(await createPaymentExecutionIntent({ ...input, execution }));
}
export async function readExecutionForSubmission(
  deploymentId: string,
  signedXdr: string,
  id?: string,
) {
  return readPaymentExecutionForSubmission(deploymentId, signedXdr, id, 1);
}
