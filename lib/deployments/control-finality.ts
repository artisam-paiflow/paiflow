import "server-only";
import type { Prisma, SignedTxKind, WalletControlIntent } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { lockDeployment } from "./service-work";

export type ControlFinality = { state: "SUCCESS" | "FAILED"; ledger: number };
export function retainedControlFinality(
  intent: Pick<WalletControlIntent, "state" | "ledger" | "network" | "txHash">,
): ControlFinality | null {
  return intent.network === env().STELLAR_NETWORK &&
    /^[a-f0-9]{64}$/.test(intent.txHash) &&
    (intent.state === "SUCCESS" || intent.state === "FAILED") &&
    validFinalityLedger(intent.ledger)
    ? { state: intent.state, ledger: intent.ledger }
    : null;
}
export const validFinalityLedger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 0xffff_ffff;

function controlSignedKinds(action: string): SignedTxKind[] {
  return action === "payment.execute"
    ? ["API_EXECUTE", "TRIGGER"]
    : [
          "configuration.mutate",
          "subscription.cancel",
          "subscription.reactivate",
          "schedule.pause",
          "schedule.resume",
          "schedule.retrieve",
          "schedule.fund",
          "webhook.fund",
        ].includes(action)
      ? ["INVOKE"]
      : [];
}

/** Hashes are network-bound, but keep every persisted attribution check explicit.
 * Old tracking versions remain valid financial evidence. Queue refusal is not failure. */
export async function storedControlFinality(
  intent: Pick<
    WalletControlIntent,
    "deploymentId" | "network" | "txHash" | "walletAddress" | "action"
  >,
  client: Prisma.TransactionClient = db,
  { includeService = true }: { includeService?: boolean } = {},
): Promise<ControlFinality | null> {
  if (intent.network !== env().STELLAR_NETWORK || !/^[a-f0-9]{64}$/.test(intent.txHash))
    return null;
  const kinds = controlSignedKinds(intent.action);
  const signed = await client.signedTransaction.findFirst({
    where: {
      txHash: intent.txHash,
      deploymentId: intent.deploymentId,
      network: intent.network,
      signerAddress: intent.walletAddress,
      signedBySource: true,
      isFeeBump: false,
      kind: { in: [...kinds] },
    },
    select: { outcome: true, ledger: true, failureCode: true },
  });
  if (!signed) return null;
  if (validFinalityLedger(signed.ledger)) {
    if (signed.outcome === "CONFIRMED") return { state: "SUCCESS", ledger: signed.ledger };
    if (signed.outcome === "FAILED" && signed.failureCode === "ONCHAIN_FAILED")
      return { state: "FAILED", ledger: signed.ledger };
  }
  if (!includeService) return null;
  // The RPC wrapper and service worker can persist finality before either the
  // intent or signed outcome is updated. Require the original verified source
  // attribution above and a receipt belonging to this deployment/network.
  const scope = {
    txHash: intent.txHash,
    transport: "rpc",
    work: { deploymentId: intent.deploymentId, deployment: { network: intent.network } },
  };
  const receipt = await client.serviceTransaction.findFirst({
    where: { ...scope, state: { in: ["SUCCESS", "FAILED"] }, ledger: { gt: 0 } },
    select: { state: true, ledger: true },
  });
  if (
    !receipt ||
    !validFinalityLedger(receipt.ledger) ||
    (receipt.state !== "SUCCESS" && receipt.state !== "FAILED")
  )
    return null;
  const conflict = await client.serviceTransaction.findFirst({
    where: {
      ...scope,
      state: { in: ["SUCCESS", "FAILED"] },
      ledger: { gt: 0 },
      OR: [{ state: { not: receipt.state } }, { ledger: { not: receipt.ledger } }],
    },
    select: { id: true },
  });
  if (conflict)
    throw new AppError("CONFLICT", "Conflicting service finality; original evidence retained");
  return { state: receipt.state, ledger: receipt.ledger };
}

/** Project authoritative exact-hash finality atomically. Never infer work completion:
 * original OPEN/BLOCKED work can contain other unverified obligations. */
export async function projectControlFinality(
  deploymentId: string,
  txHash: string,
  finality: ControlFinality,
) {
  if (!validFinalityLedger(finality.ledger))
    throw new AppError(
      "UPSTREAM_RPC",
      "Control finality has no valid ledger; reservation retained",
    );
  return db.$transaction(async (client) => {
    const deployment = await lockDeployment(client, deploymentId);
    if (deployment.serviceState === "RETIRED") return null;
    const intent = await client.walletControlIntent.findFirst({
      where: { deploymentId, txHash, network: env().STELLAR_NETWORK },
    });
    if (!intent) return null;
    if (
      !["PREPARED", "SUBMITTING", finality.state].includes(intent.state) ||
      (intent.ledger !== null && intent.ledger !== finality.ledger)
    )
      throw new AppError("CONFLICT", "Conflicting control finality; original evidence retained");
    const signed = await client.signedTransaction.findUnique({ where: { txHash } });
    if (
      signed &&
      (signed.network !== intent.network ||
        signed.deploymentId !== deploymentId ||
        signed.signerAddress !== intent.walletAddress ||
        !signed.signedBySource ||
        signed.isFeeBump ||
        !controlSignedKinds(intent.action).includes(signed.kind))
    )
      throw new AppError("CONFLICT", "Conflicting transaction attribution; reservation retained");
    if (signed?.outcome === "REJECTED" && signed.failureCode === "CONTROL_EXPIRED")
      throw new AppError("CONFLICT", "Conflicting expiry evidence; original identity retained");
    const retained = await storedControlFinality(intent, client);
    if (retained && (retained.state !== finality.state || retained.ledger !== finality.ledger))
      throw new AppError("CONFLICT", "Conflicting signed finality; original evidence retained");
    const conflictingService = await client.serviceTransaction.findFirst({
      where: {
        txHash,
        work: { deploymentId },
        state: { in: ["SUCCESS", "FAILED"] },
        OR: [{ state: { not: finality.state } }, { ledger: { not: finality.ledger } }],
      },
    });
    if (conflictingService)
      throw new AppError("CONFLICT", "Conflicting service finality; original evidence retained");
    await client.walletControlIntent.updateMany({
      where: { id: intent.id, state: { in: ["PREPARED", "SUBMITTING"] } },
      data: { state: finality.state, ledger: finality.ledger, completedAt: new Date() },
    });
    // A retained terminal intent may predate ledger enrichment or a projection crash.
    await client.walletControlIntent.updateMany({
      where: { id: intent.id, state: finality.state, ledger: null },
      data: { ledger: finality.ledger },
    });
    await client.serviceTransaction.updateMany({
      where: { txHash, state: "PENDING", work: { deploymentId } },
      data: { state: finality.state, ledger: finality.ledger },
    });
    return client.walletControlIntent.findUniqueOrThrow({ where: { id: intent.id } });
  });
}
