import "server-only";
import type { Deployment } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { recordTransactionOutcome } from "@/lib/analytics/outcomes";
import { rateLimit, rateLimitedError } from "@/lib/rate-limit";
import { sorobanRpc } from "@/lib/stellar/client";
import { invokesPipeline } from "@/lib/stellar/transaction-attribution";
import type { TransactionStatus } from "./schema";
import { recordControlFinality, repairControlAdmission } from "./control-intent";
import { refreshEventsIfStale } from "./events-freshness";

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
  const withEvents = async (result: TransactionStatus): Promise<TransactionStatus> => {
    if (result.status === "SUCCESS" && result.ledger !== undefined) {
      try {
        await refreshEventsIfStale(deployment.id, result.ledger);
      } catch {
        // Event availability never changes established financial finality.
        log.warn(
          { deploymentId: deployment.id, txHash },
          "transaction status: event catch-up unavailable",
        );
      }
    }
    return result;
  };
  const readControl = () =>
    db.walletControlIntent.findFirst({
      where: { deploymentId: deployment.id, network, txHash },
    });
  const controlFinal = (
    value: Awaited<ReturnType<typeof readControl>>,
  ): TransactionStatus | null => {
    if (value?.state === "SUCCESS" || value?.state === "FAILED")
      return {
        ...base,
        status: value.state,
        ...(value.ledger ? { ledger: value.ledger } : {}),
        ...(value.state === "FAILED"
          ? { error: { code: "ONCHAIN_FAILED", message: "Transaction failed on the network" } }
          : {}),
      };
    if (value?.state === "EXPIRED")
      return {
        ...base,
        status: "REJECTED",
        error: {
          code: "EXPIRED",
          message: "Ledger coverage proves the prepared transaction expired without inclusion",
        },
      };
    return null;
  };
  const controlResult = async (value: Awaited<ReturnType<typeof readControl>>) => {
    const final = controlFinal(value);
    if (final && value) await repairControlAdmission(value);
    return final;
  };
  const control = await readControl();
  const durableControl = await controlResult(control);
  if (durableControl) return withEvents(durableControl);

  // Every record query is scoped before returning or mutating anything. DB errors propagate.
  const where = { deploymentId: deployment.id, network, txHash, kind: { not: "DEPLOY" as const } };
  const readSigned = () => db.signedTransaction.findFirst({ where, select: signedSelect });
  const readAttempt = () =>
    db.webhookAttempt.findFirst({
      where: { deploymentId: deployment.id, network, txHash },
    });
  const attempt = await readAttempt();
  const attemptFinal = (value: typeof attempt): TransactionStatus | null =>
    value?.status === "SUCCESS" || value?.status === "FAILED"
      ? {
          ...base,
          status: value.status,
          ...(value.ledger ? { ledger: value.ledger } : {}),
          ...(value.status === "FAILED"
            ? { error: { code: "ONCHAIN_FAILED", message: "Transaction failed on the network" } }
            : {}),
        }
      : null;
  const durableAttempt = attemptFinal(attempt);
  if (durableAttempt) return withEvents(durableAttempt);
  const row = await readSigned();
  const saved = terminal(row, base);
  if (saved) {
    if (control)
      await recordControlFinality(
        deployment.id,
        txHash,
        saved.status === "SUCCESS" ? "SUCCESS" : "FAILED",
        saved.ledger,
      );
    return withEvents(saved);
  }
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
  if (event) {
    if (control) await recordControlFinality(deployment.id, txHash, "SUCCESS", event.ledger);
    return withEvents({ ...base, status: "SUCCESS", ledger: event.ledger });
  }
  const associated = Boolean(row || audit || attempt || control);
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
    const latest =
      (await controlResult(await readControl())) ??
      terminal(await readSigned(), base) ??
      attemptFinal(await readAttempt());
    if (latest) return withEvents(latest);
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
    if (control) await recordControlFinality(deployment.id, txHash, got.status, got.ledger);
    await recordTransactionOutcome(txHash, got.status === "SUCCESS" ? "CONFIRMED" : "FAILED", {
      deploymentId: deployment.id,
      executionOnly: true,
      ledger: got.ledger,
      ...(got.status === "FAILED" ? { failureCode: "ONCHAIN_FAILED" as const } : {}),
    });
    if (attempt)
      await db.webhookAttempt.updateMany({
        where: { id: attempt.id, status: { notIn: ["SUCCESS", "FAILED"] } },
        data: {
          status: got.status,
          ledger: got.ledger,
          errorCode: got.status === "FAILED" ? "ONCHAIN_FAILED" : null,
        },
      });
    return withEvents({
      ...base,
      status: got.status,
      ledger: got.ledger,
      ...(got.status === "FAILED"
        ? { error: { code: "ONCHAIN_FAILED", message: "Transaction failed on the network" } }
        : {}),
    });
  }
  // Re-read after RPC to avoid answering uncertainty over a concurrent confirmation.
  const latest = await readSigned();
  const latestAttempt = await readAttempt();
  const final =
    (await controlResult(await readControl())) ??
    terminal(latest, base) ??
    attemptFinal(latestAttempt);
  if (final) return withEvents(final);
  const current = latest ?? row;
  const currentAttempt = latestAttempt ?? attempt;
  // Positive queue evidence takes precedence over an older submission refusal.
  const accepted = Boolean(
    current?.acceptedAt ||
    current?.outcome === "ACCEPTED" ||
    currentAttempt?.acceptedAt ||
    audit?.action === "DEPLOY_TRIGGER",
  );
  if (!accepted && (current?.outcome === "REJECTED" || currentAttempt?.status === "REJECTED"))
    return {
      ...base,
      status: "REJECTED",
      error: {
        code: "RPC_REJECTED",
        message: "Submission was rejected; no on-chain failure is established",
      },
    };
  return { ...base, status: accepted ? "PENDING" : "UNKNOWN" };
}
