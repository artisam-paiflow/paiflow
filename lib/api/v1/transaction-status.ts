import "server-only";
import type { Deployment } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { recordTransactionOutcome } from "@/lib/analytics/outcomes";
import { rateLimit, rateLimitedError } from "@/lib/rate-limit";
import { sorobanRpc } from "@/lib/stellar/client";
import { invokesPipeline } from "@/lib/stellar/transaction-attribution";
import type { TransactionStatus } from "./schema";

const AUDIT_ACTIONS = [
  "DEPLOY_TRIGGER",
  "DEPLOY_INVOKE",
  "API_EXECUTE_SUBMITTED",
  "API_EXECUTE_CONFIRMED",
  "API_PAYOUT_SUBMITTED",
  "API_PAYOUT_CONFIRMED",
  "TIMELOCK_RELEASE_BEFORE",
  "API_TIMELOCK_RELEASE_BEFORE",
];
const signedSelect = { outcome: true, acceptedAt: true, ledger: true, failureCode: true } as const;
type Stored = {
  outcome: string | null;
  acceptedAt: Date | null;
  ledger: number | null;
  failureCode: string | null;
};

function terminal(
  row: Stored | null,
  base: Pick<TransactionStatus, "txHash" | "network">,
): TransactionStatus | null {
  if (row?.outcome !== "CONFIRMED" && row?.outcome !== "FAILED") return null;
  return {
    ...base,
    status: row.outcome === "CONFIRMED" ? "SUCCESS" : "FAILED",
    ...(row.ledger ? { ledger: row.ledger } : {}),
    ...(row.outcome === "FAILED"
      ? { error: { code: "ONCHAIN_FAILED", message: "Transaction failed on the network" } }
      : {}),
  };
}

export async function getTransactionStatus(
  deployment: Deployment,
  txHash: string,
): Promise<TransactionStatus> {
  const network = env().STELLAR_NETWORK;
  if (deployment.network !== network)
    throw new AppError("NOT_FOUND", "Transaction not available for this deployment");
  const base = { txHash, network };
  // Every record query is scoped before returning or mutating anything. DB errors propagate.
  const where = { deploymentId: deployment.id, network, txHash, kind: { not: "DEPLOY" as const } };
  const readSigned = () => db.signedTransaction.findFirst({ where, select: signedSelect });
  const row = await readSigned();
  const saved = terminal(row, base);
  if (saved) return saved;
  const [event, audit] = await Promise.all([
    db.contractEvent.findFirst({
      where: { deploymentId: deployment.id, txHash },
      select: { ledger: true },
    }),
    db.auditLog.findFirst({
      where: {
        action: { in: AUDIT_ACTIONS },
        AND: [
          { metadata: { path: ["deploymentId"], equals: deployment.id } },
          { metadata: { path: ["txHash"], equals: txHash } },
        ],
      },
      select: { action: true },
    }),
  ]);
  // Ingested successful contract events survive RPC history expiry.
  if (event) return { ...base, status: "SUCCESS", ledger: event.ledger };
  const associated = Boolean(row || audit);
  const budget = await rateLimit(`v1:transaction-rpc:${deployment.id}`, 60, 60);
  if (!budget.ok) throw rateLimitedError(budget);
  // RPC work has a deployment-wide bound across tokens and replicas. Fail closed in production.
  if (!budget.shared && env().NODE_ENV === "production")
    throw new AppError(
      "UPSTREAM_RPC",
      "Shared transaction lookup limiter unavailable; retry later",
    );
  let got;
  try {
    got = await sorobanRpc().getTransaction(txHash);
  } catch {
    const latest = terminal(await readSigned(), base);
    if (latest) return latest;
    throw new AppError(
      "UPSTREAM_RPC",
      "Transaction status unavailable; retry lookup without resubmitting",
    );
  }
  const envelope =
    got.status !== "NOT_FOUND"
      ? typeof got.envelopeXdr === "string"
        ? got.envelopeXdr
        : got.envelopeXdr?.toXDR("base64")
      : undefined;
  if (!associated && !(envelope && invokesPipeline(envelope, txHash, deployment.pipelineSnapshot)))
    throw new AppError("NOT_FOUND", "Transaction not available for this deployment");
  if (got.status === "SUCCESS" || got.status === "FAILED") {
    await recordTransactionOutcome(txHash, got.status === "SUCCESS" ? "CONFIRMED" : "FAILED", {
      deploymentId: deployment.id,
      executionOnly: true,
      ledger: got.ledger,
      ...(got.status === "FAILED" ? { failureCode: "ONCHAIN_FAILED" as const } : {}),
    });
    return {
      ...base,
      status: got.status,
      ledger: got.ledger,
      ...(got.status === "FAILED"
        ? { error: { code: "ONCHAIN_FAILED", message: "Transaction failed on the network" } }
        : {}),
    };
  }
  // Re-read after RPC to avoid answering uncertainty over a concurrent confirmation.
  const latest = await readSigned();
  const final = terminal(latest, base);
  if (final) return final;
  const current = latest ?? row;
  if (current?.outcome === "REJECTED" && !current.acceptedAt)
    return {
      ...base,
      status: "REJECTED",
      error: {
        code: "RPC_REJECTED",
        message: "Submission was rejected; no on-chain failure is established",
      },
    };
  // Webhook DEPLOY_TRIGGER is written only after sendTransaction queued the hash.
  const accepted = Boolean(
    current?.acceptedAt || current?.outcome === "ACCEPTED" || audit?.action === "DEPLOY_TRIGGER",
  );
  return { ...base, status: accepted ? "PENDING" : "UNKNOWN" };
}
