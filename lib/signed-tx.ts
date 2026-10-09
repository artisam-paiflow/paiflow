import "server-only";
import type { Prisma, SignedTxKind } from "@prisma/client";
import { enqueueAnalytics, deliverOutbox } from "./analytics/outbox";
import { audienceFor, TRACKING_VERSION } from "./analytics/policy";
import { env } from "./env";
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
  apiTokenId?: string | null;
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
    apiTokenId: input.apiTokenId ?? null,
    trackingVersion: TRACKING_VERSION,
    outcome: "RECEIVED",
    submittedAt: new Date(),
    nextCheckAt: new Date(Date.now() + 30_000),
  };
}

/**
 * Insert the row, or do nothing when the hash is already recorded. Returns
 * whether this call created it, so the analytics copy fires once per hash
 * and not once per resubmission (`ON CONFLICT DO NOTHING` reports that
 * atomically; an upsert cannot). Pass a transaction client to make the write
 * part of the caller's own transaction, where a failure aborts the caller
 * before the chain call — the deploy route does this alongside its status
 * flip.
 */
export async function insertSignedTransaction(
  row: Prisma.SignedTransactionUncheckedCreateInput,
  client?: Prisma.TransactionClient,
): Promise<boolean> {
  if (!client) return db.$transaction((tx) => insertSignedTransaction(row, tx));
  const user = row.userId
    ? await client.user.findUnique({
        where: { id: row.userId },
        select: { id: true, role: true, analyticsAudience: true },
      })
    : row.apiTokenId
      ? ((
          await client.deploymentApiToken.findUnique({
            where: { id: row.apiTokenId },
            include: {
              deployment: {
                select: { owner: { select: { id: true, role: true, analyticsAudience: true } } },
              },
            },
          })
        )?.deployment.owner ?? null)
      : null;
  const audience = audienceFor(user);
  const { count } = await client.signedTransaction.createMany({
    data: [{ ...row, audience, callerAccountId: user?.id ?? null }],
    skipDuplicates: true,
  });
  if (count)
    await enqueueAnalytics(client, {
      key: `${row.network}:signed:${row.txHash}`,
      distinctId:
        row.userId ?? (row.apiTokenId ? `api:${row.apiTokenId}` : `wallet:${row.signerAddress}`),
      name: "transaction_signed",
      properties: {
        deployment_id: row.deploymentId ?? null,
        tx_hash: row.txHash,
        signer_address: row.signerAddress,
        kind: EVENT_KIND[row.kind],
        signed_by_source: row.signedBySource ?? true,
      },
      context: {
        audience,
        account_id: user?.id ?? "",
        caller_type: row.userId ? "session" : row.apiTokenId ? "api" : "wallet",
        stellar_network: row.network,
        app_env: env().NEXT_PUBLIC_APP_ENV,
        app_version: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
        app_host: new URL(env().NEXT_PUBLIC_APP_URL).host,
        tracking_version: TRACKING_VERSION,
      },
      personProfile: Boolean(row.userId),
    });
  return count === 1;
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
 * the row is committed, never inside the transaction that writes it, and only
 * when `insertSignedTransaction` created the row — one event per hash.
 */
export function captureTransactionSigned(_row: Prisma.SignedTransactionUncheckedCreateInput): void {
  // The transactional outbox owns the event. This only accelerates its delivery.
  if (env().NEXT_PUBLIC_POSTHOG_KEY)
    void deliverOutbox({ batch: 1, budgetMs: 2_000 }).catch(() => {
      log.warn("analytics: immediate delivery unavailable; queued for reconciliation");
    });
}

/**
 * Durable write before submission. A DB failure stops the chain call, so a
 * successful submission cannot silently lose its traceability record.
 */
export async function recordSignedTransaction(input: SignedTransactionInput): Promise<void> {
  const row = signedTransactionRow(input);
  if (!row) throw new Error("Cannot record an unreadable signed envelope");
  const created = await insertSignedTransaction(row);
  if (created) captureTransactionSigned(row);
}
