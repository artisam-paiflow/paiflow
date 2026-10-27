import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Address, Transaction, TransactionBuilder, scValToNative } from "@stellar/stellar-sdk";
import { integerNumber } from "@/lib/validation/number";
import { AppError } from "@/lib/errors";
import { env, stellarPassphrase } from "@/lib/env";
import { signerFromTransaction } from "@/lib/stellar/signer";

const IntentSchema = z
  .object({
    deploymentId: z.string(),
    network: z.enum(["testnet", "mainnet"]),
    subscriber: z.string(),
    tokenContractAddress: z.string(),
    contractAddress: z.string(),
    amount: z.string(),
    preparationLedger: z.number().int().positive().max(0xffff_ffff).optional(),
    maxTime: z.string().regex(/^[1-9][0-9]*$/),
    txHash: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: integerNumber(),
  })
  .strict();
type Intent = z.infer<typeof IntentSchema>;
function mac(payload: string) {
  return createHmac("sha256", env().AUTH_SECRET)
    .update(`subscription-allowance:v1:${payload}`)
    .digest();
}
function parseTx(value: string) {
  try {
    const tx = TransactionBuilder.fromXDR(value, stellarPassphrase());
    if (!(tx instanceof Transaction)) throw new Error();
    return tx;
  } catch {
    throw new AppError("VALIDATION", "Invalid allowance transaction envelope");
  }
}
function assertApproval(
  tx: Transaction,
  intent: Pick<Intent, "subscriber" | "tokenContractAddress" | "contractAddress" | "amount">,
) {
  try {
    const op = tx.operations[0];
    if (
      tx.source !== intent.subscriber ||
      tx.operations.length !== 1 ||
      op?.type !== "invokeHostFunction" ||
      (op.source && op.source !== intent.subscriber)
    )
      throw new Error();
    if (op.func.switch().name !== "hostFunctionTypeInvokeContract") throw new Error();
    const call = op.func.invokeContract();
    const args = call.args();
    if (
      Address.fromScAddress(call.contractAddress()).toString() !== intent.tokenContractAddress ||
      call.functionName().toString() !== "approve" ||
      args.length !== 4 ||
      Address.fromScVal(args[0]!).toString() !== intent.subscriber ||
      Address.fromScVal(args[1]!).toString() !== intent.contractAddress ||
      args[2]!.switch().name !== "scvI128" ||
      String(scValToNative(args[2]!)) !== intent.amount ||
      args[3]!.switch().name !== "scvU32"
    )
      throw new Error();
  } catch {
    throw new AppError("VALIDATION", "Transaction is not the intended subscription token approval");
  }
}

export function createAllowanceIntent(
  xdr: string,
  state: {
    preparationLedger: number;
    deploymentId: string;
    network: "testnet" | "mainnet";
    subscriber: string;
    tokenContractAddress: string;
    contractAddress: string;
  },
  amount: string,
) {
  const tx = parseTx(xdr);
  const intent: Intent = {
    ...state,
    amount,
    maxTime: tx.timeBounds?.maxTime ?? "0",
    txHash: tx.hash().toString("hex"),
    expiresAt: Date.now() + 10 * 60_000,
  };
  if (!tx.timeBounds || BigInt(intent.maxTime) <= 0n)
    throw new AppError("INTERNAL", "Prepared allowance must have a finite expiration");
  IntentSchema.parse(intent);
  assertApproval(tx, intent);
  const payload = Buffer.from(JSON.stringify(intent)).toString("base64url");
  return { intent: `${payload}.${mac(payload).toString("base64url")}`, txHash: intent.txHash };
}

export function readAllowanceIntent(token: string, deploymentId: string, checkExpiry = false) {
  const parts = token.split(".");
  let intent: Intent;
  try {
    if (parts.length !== 2) throw new Error();
    const expected = mac(parts[0]!);
    const received = Buffer.from(parts[1]!, "base64url");
    if (received.length !== expected.length || !timingSafeEqual(received, expected))
      throw new Error();
    intent = IntentSchema.parse(JSON.parse(Buffer.from(parts[0]!, "base64url").toString()));
    if (
      intent.deploymentId !== deploymentId ||
      intent.network !== env().STELLAR_NETWORK ||
      (checkExpiry && intent.expiresAt < Date.now())
    )
      throw new Error();
  } catch {
    throw new AppError(
      "VALIDATION",
      "Allowance approval intent is invalid or expired; check transaction status before preparing again",
    );
  }
  return intent;
}

export function verifyAllowanceIntent(token: string, signedXdr: string, deploymentId: string) {
  const intent = readAllowanceIntent(token, deploymentId, true);
  const tx = parseTx(signedXdr);
  if (tx.hash().toString("hex") !== intent.txHash)
    throw new AppError(
      "VALIDATION",
      "Signed transaction does not match the prepared allowance approval",
    );
  assertApproval(tx, intent);
  const signer = signerFromTransaction(tx);
  if (!signer.ok || !signer.signedBySource || signer.signerAddress !== intent.subscriber)
    throw new AppError(
      "FORBIDDEN",
      "Allowance must be signed by the configured subscriber on the deployment network",
    );
  return { intent, signer, tx };
}
