import "server-only";
import { CRON_LIMITS } from "@/lib/cron/config";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { observeServiceTransaction, runDeploymentWork } from "@/lib/deployments/service-work";
import { horizon, sorobanRpc } from "./client";
import { withInteractiveRpcBudget } from "./interactive-rpc-budget";

type Finality = { state: "SUCCESS" | "FAILED"; ledger: number };
const validLedger = (ledger: unknown): ledger is number =>
  typeof ledger === "number" && Number.isSafeInteger(ledger) && ledger > 0;

async function readFinality(txHash: string, transport: string): Promise<Finality | null> {
  // A verified terminal signed row survives the provider's retention window.
  // Rejection/expiry and unknown outcomes are deliberately insufficient proof.
  const signed = await db.signedTransaction.findUnique({
    where: { txHash },
    select: { network: true, outcome: true, ledger: true, failureCode: true },
  });
  if (signed?.network === env().STELLAR_NETWORK && validLedger(signed.ledger)) {
    if (signed.outcome === "CONFIRMED") return { state: "SUCCESS", ledger: signed.ledger };
    if (signed.outcome === "FAILED" && signed.failureCode === "ONCHAIN_FAILED")
      return { state: "FAILED", ledger: signed.ledger };
  }
  if (transport === "rpc") {
    const got = await sorobanRpc().getTransaction(txHash);
    if ((got.status === "SUCCESS" || got.status === "FAILED") && validLedger(got.ledger))
      return { state: got.status, ledger: got.ledger };
  } else if (transport === "horizon") {
    const got = await horizon().transactions().transaction(txHash).call();
    if (typeof got.successful === "boolean" && validLedger(got.ledger_attr))
      return { state: got.successful ? "SUCCESS" : "FAILED", ledger: got.ledger_attr };
  }
  return null;
}

/** Project original-hash finality independently of browser polling and analytics.
 * Only metadata is repaired here; deployment setup and obligated retirement work
 * retain their dedicated reconciliation paths. */
export async function reconcileServiceTransactions({
  batch = CRON_LIMITS.reconcileServiceTransactions.batch,
  budgetMs = CRON_LIMITS.reconcileServiceTransactions.budgetMs,
}: { batch?: number; budgetMs?: number } = {}) {
  const started = Date.now();
  let visited = 0;
  let checked = 0;
  let confirmed = 0;
  let failed = 0;
  let unresolved = 0;
  const rows = await db.serviceTransaction.findMany({
    where: {
      state: "PENDING",
      nextCheckAt: { lte: new Date() },
      work: { deployment: { serviceState: "ACTIVE", network: env().STELLAR_NETWORK } },
    },
    orderBy: [{ nextCheckAt: "asc" }, { id: "asc" }],
    take: batch,
    select: {
      id: true,
      txHash: true,
      transport: true,
      nextCheckAt: true,
      checkAttempts: true,
      createdAt: true,
      work: { select: { deploymentId: true } },
    },
  });
  const observations = new Map<string, Finality | null>();
  for (const row of rows) {
    if (Date.now() - started >= budgetMs) break;
    visited++;
    await runDeploymentWork(row.work.deploymentId, "service-finality-reconciliation", async () => {
      const claimed = await db.serviceTransaction.updateMany({
        where: { id: row.id, state: "PENDING", nextCheckAt: row.nextCheckAt },
        data: {
          lastCheckedAt: new Date(),
          checkAttempts: { increment: 1 },
          // Reserve before I/O, so a crashed/failed read rotates behind other work.
          // No age cutoff changes finality or erases the retained pending record.
          nextCheckAt: new Date(
            Date.now() +
              Math.min(
                Date.now() - row.createdAt.getTime() < 15 * 60_000 ? 60_000 : 900_000,
                30_000 * 2 ** Math.min(row.checkAttempts, 5),
              ),
          ),
        },
      });
      if (!claimed.count) return;
      checked++;
      const key = `${row.transport}:${row.txHash}`;
      try {
        if (!observations.has(key)) {
          observations.set(
            key,
            await withInteractiveRpcBudget(
              () => readFinality(row.txHash, row.transport),
              Math.max(1, Math.min(3_000, budgetMs - (Date.now() - started))),
            ),
          );
        }
        const finality = observations.get(key);
        if (finality) {
          await observeServiceTransaction(row.txHash, finality.state, finality.ledger);
          if (finality.state === "SUCCESS") confirmed++;
          else failed++;
        } else unresolved++;
      } catch {
        unresolved++;
        // Cache unavailable evidence for shared participants during this tick.
        observations.set(key, null);
        log.warn({ txHash: row.txHash }, "service finality reconciliation: evidence unavailable");
      }
    });
  }
  return { checked, confirmed, failed, unresolved, truncated: visited < rows.length };
}
