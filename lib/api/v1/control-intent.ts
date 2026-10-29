import "server-only";
import {
  Address,
  StrKey,
  Transaction,
  TransactionBuilder,
  scValToNative,
} from "@stellar/stellar-sdk";
import type { Deployment, WalletControlIntent } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { recordTransactionOutcome } from "@/lib/analytics/outcomes";
import { env, stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { lockDeployment, observeServiceTransaction } from "@/lib/deployments/service-work";
import { pipelineNodesOfKind } from "@/lib/pipeline-snapshot";
import { signerFromTransaction } from "@/lib/stellar/signer";
import { allowanceHasExpired } from "@/lib/stellar/allowance-status";
import { sorobanRpc } from "@/lib/stellar/client";
import { invalidateDashboardBalances } from "@/lib/stellar/dashboard-balance-cache";
export const WalletControlActionSchema = z.enum([
  "subscription.cancel",
  "subscription.reactivate",
  "schedule.pause",
  "schedule.resume",
  "schedule.retrieve",
  "schedule.fund",
  "webhook.fund",
]);
export type WalletControlAction = z.infer<typeof WalletControlActionSchema>;
export const WalletControlSubmitSchema = z
  .object({
    intent: z.string().guid({ error: "Invalid uuid" }),
    signedXdr: z.string().min(1).max(100000),
  })
  .strict();
const actions = {
  "subscription.cancel": { method: "unsubscribe", kinds: ["SUBSCRIPTION"] },
  "subscription.reactivate": { method: "subscribe", kinds: ["SUBSCRIPTION"] },
  "schedule.pause": { method: "pause", kinds: ["STREAMER"] },
  "schedule.resume": { method: "unpause", kinds: ["STREAMER"] },
  "schedule.retrieve": { method: "retrieve_unvested", kinds: ["STREAMER"] },
  "schedule.fund": { method: "top_up", kinds: ["STREAMER"] },
  "webhook.fund": { method: "deposit", kinds: ["WEBHOOK"] },
} as const;
export type ControlBinding = Pick<
  WalletControlIntent,
  | "deploymentId"
  | "network"
  | "nodeId"
  | "contractAddress"
  | "walletAddress"
  | "action"
  | "txHash"
  | "maxTime"
>;
export function parseControlTransaction(value: string): Transaction {
  try {
    const tx = TransactionBuilder.fromXDR(value, stellarPassphrase());
    if (!(tx instanceof Transaction)) throw new Error();
    return tx;
  } catch {
    throw new AppError(
      "VALIDATION",
      "Invalid wallet-control transaction; fee-bump envelopes are unsupported",
    );
  }
}
/** Restrict the foundation to the named action shapes; never a generic invocation relay. */
export function assertControlTransaction(tx: Transaction, binding: ControlBinding) {
  const action = WalletControlActionSchema.parse(binding.action);
  try {
    const op = tx.operations[0];
    if (
      binding.network !== env().STELLAR_NETWORK ||
      tx.source !== binding.walletAddress ||
      !StrKey.isValidEd25519PublicKey(binding.walletAddress) ||
      tx.operations.length !== 1 ||
      op?.type !== "invokeHostFunction" ||
      (op.source && op.source !== binding.walletAddress) ||
      op.func.switch().name !== "hostFunctionTypeInvokeContract" ||
      !tx.timeBounds ||
      BigInt(tx.timeBounds.maxTime) <= 0n ||
      tx.timeBounds.maxTime !== binding.maxTime ||
      tx.hash().toString("hex") !== binding.txHash
    )
      throw new Error();
    const call = op.func.invokeContract();
    if (
      Address.fromScAddress(call.contractAddress()).toString() !== binding.contractAddress ||
      call.functionName().toString() !== actions[action].method
    )
      throw new Error();
    const args = call.args();
    if (action === "schedule.fund" || action === "webhook.fund") {
      if (
        args.length !== 2 ||
        Address.fromScVal(args[0]!).toString() !== binding.walletAddress ||
        args[1]!.switch().name !== "scvI128" ||
        BigInt(String(scValToNative(args[1]!))) <= 0n
      )
        throw new Error();
    } else if (args.length !== 0) throw new Error();
    // These builders use the wallet as source. Source credentials authenticate its
    // nested calls. Address credentials require another signing protocol, so fail closed.
    if (
      (op.auth ?? []).some(
        (auth) => auth.credentials().switch().name !== "sorobanCredentialsSourceAccount",
      )
    )
      throw new Error();
  } catch {
    throw new AppError("VALIDATION", "Transaction does not match the prepared wallet control");
  }
}
export function verifyControlTransaction(binding: ControlBinding, signedXdr: string) {
  const tx = parseControlTransaction(signedXdr);
  assertControlTransaction(tx, binding);
  const signer = signerFromTransaction(tx);
  if (!signer.ok || !signer.signedBySource || signer.signerAddress !== binding.walletAddress)
    throw new AppError(
      "FORBIDDEN",
      "Control must be signed by the required wallet on the deployment network",
    );
  return { tx, signer };
}
/** Builders must simulate with the required wallet as source before calling this. */
export async function createControlIntent(input: {
  deployment: Pick<Deployment, "id" | "network" | "status" | "pipelineSnapshot">;
  nodeId: string;
  action: WalletControlAction;
  walletAddress: string;
  unsignedXdr: string;
  /** Capture before preparing/simulating so expiry checks cover the entire validity window. */
  preparationLedger: number;
}) {
  const action = WalletControlActionSchema.parse(input.action);
  const { deployment } = input;
  if (deployment.network !== env().STELLAR_NETWORK || deployment.status !== "CONFIRMED")
    throw new AppError("NOT_FOUND", "Deployment not available on this network");
  z.number().int().positive().max(4294967295).parse(input.preparationLedger);
  const candidates = actions[action].kinds.flatMap((kind) =>
    pipelineNodesOfKind(deployment.pipelineSnapshot, kind),
  );
  const matches = candidates.filter((node) => node.nodeId === input.nodeId);
  if (matches.length !== 1)
    throw new AppError("VALIDATION", "Control node is unsupported or ambiguous");
  const tx = parseControlTransaction(input.unsignedXdr);
  const data = {
    deploymentId: deployment.id,
    network: deployment.network,
    nodeId: input.nodeId,
    contractAddress: matches[0]!.contractAddress,
    action,
    walletAddress: input.walletAddress,
    txHash: tx.hash().toString("hex"),
    maxTime: tx.timeBounds?.maxTime ?? "0",
    preparationLedger: input.preparationLedger,
  };
  assertControlTransaction(tx, data);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (tx.signatures.length || BigInt(data.maxTime) <= now || BigInt(data.maxTime) > now + 300n)
    throw new AppError("VALIDATION", "Preparation must be unsigned and expire within five minutes");
  const intent = await db.$transaction(async (client) => {
    const service = await lockDeployment(client, deployment.id);
    if (service.serviceState !== "ACTIVE")
      throw new AppError("CONFLICT", "Deployment service is closed");
    const previous = await client.walletControlIntent.findFirst({
      where: {
        deploymentId: deployment.id,
        network: deployment.network,
        nodeId: input.nodeId,
        state: { in: ["PREPARED", "SUBMITTING"] },
      },
    });
    if (previous)
      throw new AppError(
        "CONFLICT",
        "A previous control requires finality reconciliation before preparing another",
        { txHash: [previous.txHash], intent: [previous.id] },
      );
    return client.walletControlIntent.create({ data });
  });
  return {
    intent: intent.id,
    txHash: intent.txHash,
    expiresAt: new Date(Number(intent.maxTime) * 1000).toISOString(),
  };
}
export async function readControlIntent(
  id: string,
  deploymentId: string,
  action: WalletControlAction,
) {
  z.string().guid({ error: "Invalid uuid" }).parse(id);
  const intent = await db.walletControlIntent.findFirst({
    where: {
      id,
      deploymentId,
      network: env().STELLAR_NETWORK,
      action,
    },
  });
  if (!intent) throw new AppError("NOT_FOUND", "Wallet-control preparation not found");
  return intent;
}
/** Explicit reconciliation, never wall-clock cleanup. Limited history retains the reservation. */
export async function reconcileControlIntent(
  id: string,
  deploymentId: string,
  action: WalletControlAction,
) {
  const intent = await readControlIntent(id, deploymentId, action);
  if (!["PREPARED", "SUBMITTING"].includes(intent.state)) {
    await repairControlAdmission(intent);
    return intent;
  }
  let result;
  try {
    result = await sorobanRpc().getTransaction(intent.txHash);
  } catch {
    throw new AppError("UPSTREAM_RPC", "Control finality unavailable; reservation retained");
  }
  let state: "SUCCESS" | "FAILED" | "EXPIRED";
  if (result.status === "SUCCESS" || result.status === "FAILED") state = result.status;
  else if (await allowanceHasExpired(intent)) state = "EXPIRED";
  else return intent;
  // Deployment row lock also fences submission claiming against expiry reconciliation.
  await db.$transaction(async (client) => {
    await lockDeployment(client, deploymentId);
    await client.walletControlIntent.updateMany({
      where: { id: intent.id, state: { in: ["PREPARED", "SUBMITTING"] } },
      data: {
        state,
        completedAt: new Date(),
        ...(state !== "EXPIRED"
          ? { ledger: result.status !== "NOT_FOUND" ? result.ledger : undefined }
          : {}),
      },
    });
  });
  const reconciled = await readControlIntent(id, deploymentId, action);
  await repairControlAdmission(reconciled);
  return readControlIntent(id, deploymentId, action);
}
/** Final status evidence closes the reservation, including when recovered after a crash. */
export async function recordControlFinality(
  deploymentId: string,
  txHash: string,
  state: "SUCCESS" | "FAILED",
  ledger?: number,
) {
  await db.walletControlIntent.updateMany({
    where: { deploymentId, txHash, state: { in: ["PREPARED", "SUBMITTING"] } },
    data: { state, ledger, completedAt: new Date() },
  });
  const intent = await db.walletControlIntent.findFirst({
    where: { deploymentId, txHash, network: env().STELLAR_NETWORK },
  });
  if (intent) await repairControlAdmission(intent);
  if (state === "SUCCESS") invalidateDashboardBalances(deploymentId, txHash);
}
/** Repair a crash between durable finality and admission bookkeeping, without RPC history. */
export async function repairControlAdmission(
  intent: Pick<
    WalletControlIntent,
    "id" | "deploymentId" | "network" | "state" | "txHash" | "ledger"
  >,
) {
  if (intent.network !== env().STELLAR_NETWORK) return;
  if (intent.state === "SUCCESS" || intent.state === "FAILED" || intent.state === "EXPIRED") {
    await recordTransactionOutcome(
      intent.txHash,
      intent.state === "SUCCESS" ? "CONFIRMED" : intent.state === "FAILED" ? "FAILED" : "REJECTED",
      {
        deploymentId: intent.deploymentId,
        executionOnly: true,
        controlIntentId: intent.id,
        ...(intent.ledger !== null ? { ledger: intent.ledger } : {}),
        ...(intent.state === "FAILED"
          ? { failureCode: "ONCHAIN_FAILED" as const }
          : intent.state === "EXPIRED"
            ? { failureCode: "CONTROL_EXPIRED" as const }
            : {}),
      },
    );
    await observeServiceTransaction(
      intent.txHash,
      intent.state === "EXPIRED" ? "REJECTED" : intent.state,
      intent.ledger ?? undefined,
      true,
    );
  }
}
