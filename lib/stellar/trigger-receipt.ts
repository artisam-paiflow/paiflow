import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { z } from "zod";
import { env, stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";

const Receipt = z
  .object({
    deploymentId: z.string(),
    network: z.enum(["testnet", "mainnet"]),
    txHash: z.string().regex(/^[a-f0-9]{64}$/),
    maxTime: z.string().regex(/^[1-9][0-9]*$/),
    preparationLedger: z.number().int().positive().max(0xffff_ffff),
  })
  .strict();
function mac(payload: string) {
  return createHmac("sha256", env().AUTH_SECRET).update(`trigger-status:v1:${payload}`).digest();
}
/** Read-only receipt: it authorizes no submission and contains no envelope. */
export function createTriggerReceipt(xdr: string, deploymentId: string, preparationLedger: number) {
  const tx = TransactionBuilder.fromXDR(xdr, stellarPassphrase());
  if (!(tx instanceof Transaction)) throw new AppError("INTERNAL", "Invalid prepared trigger");
  const receipt = Receipt.parse({
    deploymentId,
    network: env().STELLAR_NETWORK,
    preparationLedger,
    txHash: tx.hash().toString("hex"),
    maxTime: tx.timeBounds?.maxTime ?? "0",
  });
  const payload = Buffer.from(JSON.stringify(receipt)).toString("base64url");
  return { txHash: receipt.txHash, receipt: `${payload}.${mac(payload).toString("base64url")}` };
}
export function readTriggerReceipt(token: string, deploymentId: string, txHash: string) {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) throw new Error();
    const signature = Buffer.from(parts[1]!, "base64url");
    const expected = mac(parts[0]!);
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected))
      throw new Error();
    const receipt = Receipt.parse(JSON.parse(Buffer.from(parts[0]!, "base64url").toString()));
    if (
      receipt.deploymentId !== deploymentId ||
      receipt.network !== env().STELLAR_NETWORK ||
      receipt.txHash !== txHash
    )
      throw new Error();
    return receipt;
  } catch {
    throw new AppError("VALIDATION", "Invalid trigger status receipt");
  }
}
