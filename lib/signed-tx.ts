import "server-only";
import type { Prisma, PrismaClient, SignedTxKind } from "@prisma/client";
import { captureServer } from "./analytics/server";
import { db } from "./db";
import { log } from "./log";
import type { SignerInfo } from "./stellar/signer";

/**
 * The system of record for "which wallet signed which transaction, under
 * which app account". One row per envelope this app submitted, keyed on the
 * transaction hash so a resubmission is a no-op rather than a second row.
 *
 * `userId` is the session user who submitted the envelope, or null when there
 * was no session (the public trigger page, the partner API). The app holds no
 * wallet↔user binding, so this records who used the wallet through the app,
 * not key custody — `signedBySource` is the cryptographic part. It is never
 * the deployment's owner: an anonymous visitor can fund someone else's flow,
 * and saying the owner signed it would be a lie the audit trail cannot take
 * back.
 *
 * Written before `sendTransaction`, not after confirmation: the signer and the
 * hash are known from the envelope alone, and a row for a transaction the RPC
 * then rejects is still true — it was signed, and the hash lets anyone check
 * the chain.
 */
export type SignedTransactionInput = {
  signer: SignerInfo;
  kind: SignedTxKind;
  network: string;
  userId?: string | null;
  deploymentId?: string | null;
  ip?: string | null;
};

/** The row for a parsed envelope, or null when the envelope could not be read. */
export function signedTransactionRow(
  input: SignedTransactionInput,
): Prisma.SignedTransactionUncheckedCreateInput | null {
  const { signer } = input;
  if (!signer.ok) {
    // A spike here means someone is POSTing junk at a public submit route.
    log.warn(
      { reason: signer.reason, kind: input.kind, deploymentId: input.deploymentId ?? null },
      "signed-tx: envelope unreadable, nothing recorded",
    );
    return null;
  }
  return {
    txHash: signer.txHash.toLowerCase(),
    signerAddress: signer.signerAddress,
    feeSourceAddress: signer.isFeeBump ? signer.feeSourceAddress : null,
    muxedSource: signer.muxedSource,
    isFeeBump: signer.isFeeBump,
    signedBySource: signer.signedBySource,
    userId: input.userId ?? null,
    deploymentId: input.deploymentId ?? null,
    kind: input.kind,
    network: input.network,
    ip: input.ip ?? null,
  };
}

/**
 * Upsert the row. Pass a transaction client to make the write part of the
 * caller's own transaction, where a failure aborts the caller before the chain
 * call — the deploy route does this alongside its status flip.
 */
export async function upsertSignedTransaction(
  row: Prisma.SignedTransactionUncheckedCreateInput,
  client: Prisma.TransactionClient | PrismaClient = db,
): Promise<void> {
  await client.signedTransaction.upsert({
    where: { txHash: row.txHash },
    create: row,
    update: {},
  });
}

const EVENT_KIND: Record<SignedTxKind, "deploy" | "trigger" | "invoke" | "api_execute"> = {
  DEPLOY: "deploy",
  TRIGGER: "trigger",
  INVOKE: "invoke",
  API_EXECUTE: "api_execute",
};

/**
 * The PostHog copy of the row, so the same three facts can be read next to the
 * funnel. Attributed to the signer's user when there is one; otherwise keyed
 * on the wallet with no person profile, so an anonymous signer never becomes
 * a PostHog person. Fire-and-forget like every server capture; call it after
 * the row is committed, never inside the transaction that writes it.
 */
export function captureTransactionSigned(row: Prisma.SignedTransactionUncheckedCreateInput): void {
  const props = {
    deployment_id: row.deploymentId ?? null,
    tx_hash: row.txHash,
    signer_address: row.signerAddress,
    kind: EVENT_KIND[row.kind],
    signed_by_source: row.signedBySource ?? true,
  };
  if (row.userId) {
    void captureServer(row.userId, "transaction_signed", props);
  } else {
    void captureServer(`wallet:${row.signerAddress}`, "transaction_signed", props, {
      personProfile: false,
    });
  }
}

/**
 * Best-effort variant for the public submit routes, which have no transaction
 * to join. It never throws into the response, but it logs at `error` rather
 * than `warn`: a silently lost traceability row is the failure that defeats
 * the feature, so it has to be loud.
 */
export async function recordSignedTransaction(input: SignedTransactionInput): Promise<void> {
  const row = signedTransactionRow(input);
  if (!row) return;
  try {
    await upsertSignedTransaction(row);
  } catch (err) {
    log.error(
      { err, txHash: row.txHash, kind: row.kind, deploymentId: row.deploymentId ?? null },
      "signed-tx: record failed",
    );
    return;
  }
  captureTransactionSigned(row);
}
