import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  withInteractiveRpcBudget,
  remainingInteractiveRpcMs,
  withIndependentEventRpcBudget,
} from "@/lib/stellar/interactive-rpc-budget";
import { deploymentServiceRoute } from "@/lib/deployments/service-route";
import { recordTransactionOutcome } from "@/lib/analytics/outcomes";
import { sorobanRpc } from "@/lib/stellar/client";
import { AppError, withErrorHandler } from "@/lib/errors";
import { invalidateDashboardBalances } from "@/lib/stellar/dashboard-balance-cache";
import { audit, wasTxSubmittedFor } from "@/lib/audit";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { pollEventsFor, recordAllowanceEvent } from "@/lib/stellar/events";
import type { FlowGraph } from "@/lib/flows/schema";
import { redis } from "@/lib/redis";
import { captureServer } from "@/lib/analytics/server";

const QuerySchema = z.object({
  // A Stellar transaction hash is a SHA-256, so 64 hex characters. Anything else
  // is rejected before it can reach the RPC or the database. Lowercased because
  // that is the form the SDK produces and therefore the form the audit rows
  // carry, and the lookup below compares for equality.
  txHash: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "txHash must be 64 hex characters")
    .transform((h) => h.toLowerCase()),
});

// Event ingestion uses at most five seconds of the remaining interactive budget.
// Its explicitly owned worker cannot extend the original RPC deadline.
const EVENT_INGEST_DEADLINE_MS = 5_000;

// The status route is public, so the caller has no session to attribute a
// trigger to. The `SignedTransaction` row written at submit says who signed:
// its user when the signer was signed in, else the wallet itself with no
// person profile. Unknown historical signers remain unattributed.
// Best-effort like the rest of the bookkeeping here: it never affects the
// status answer.
//
// A terminal status stays terminal, so a remount, a second tab, a reload or a
// script replaying the hash polls it again. The route is public, so everything
// a terminal status sets off — the audit row, the event ingest, the synthetic
// allowance event and the analytics capture — hangs off one Redis claim per
// (deployment, tx, outcome) and happens once. The key keeps its `analytics:`
// name from when it guarded the capture alone, so claims already taken on a
// running service still hold.
//
// Without Redis, or when the claim itself errors, there is nothing to claim
// against and every poll does the work, as before: the rate limiter has fallen
// back to per-process memory by then too, and skipping the ingest would cost a
// real user their events for a minute.
const OUTCOME_CLAIM_TTL_SECONDS = 7 * 24 * 60 * 60;
// A claim starts as a short lease and is only kept for the full week once the
// submit lookup has answered. A request that dies between the two — a restart
// mid-poll, or a lookup failure whose release also fails — then blocks a retry
// for a minute, not for a week.
const OUTCOME_LEASE_SECONDS = 60;
type Outcome = "confirmed" | "failed";
// "unclaimed" is not "taken": there was nothing to claim against, so the work
// goes ahead, but the key is not ours to keep or release.
type Claim = "owned" | "taken" | "unclaimed";

function outcomeClaimKey(deploymentId: string, txHash: string, outcome: Outcome): string {
  return `analytics:trigger:${deploymentId}:${txHash}:${outcome}`;
}

async function claimOutcome(
  deploymentId: string,
  txHash: string,
  outcome: Outcome,
): Promise<Claim> {
  const client = redis();
  if (!client) return "unclaimed";
  try {
    const claimed = await client.set(
      outcomeClaimKey(deploymentId, txHash, outcome),
      "1",
      "EX",
      OUTCOME_LEASE_SECONDS,
      "NX",
    );
    return claimed === "OK" ? "owned" : "taken";
  } catch (err) {
    log.warn(
      { err, deploymentId, txHash },
      "tx-status: outcome claim failed, proceeding unclaimed",
    );
    return "unclaimed";
  }
}

async function keepOutcome(claim: Claim, deploymentId: string, txHash: string, outcome: Outcome) {
  if (claim !== "owned") return;
  const key = outcomeClaimKey(deploymentId, txHash, outcome);
  await redis()
    ?.expire(key, OUTCOME_CLAIM_TTL_SECONDS)
    .catch((err) => {
      log.warn({ err, key }, "tx-status: could not extend the outcome claim past its lease");
    });
}

// Only for a claim this request took and whose work never started, so the next
// poll can retry it. An unowned key may be a later request's claim.
async function releaseOutcome(
  claim: Claim,
  deploymentId: string,
  txHash: string,
  outcome: Outcome,
) {
  if (claim !== "owned") return;
  const key = outcomeClaimKey(deploymentId, txHash, outcome);
  await redis()
    ?.del(key)
    .catch((err) => {
      log.warn({ err, key }, "tx-status: outcome claim release failed, it lapses with its lease");
    });
}

async function captureTriggerOutcome(
  deploymentId: string,
  txHash: string,
  outcome: Outcome,
): Promise<void> {
  try {
    const [d, signed] = await Promise.all([
      db.deployment.findUnique({
        where: { id: deploymentId },
        select: { ownerId: true, pipelineSnapshot: true },
      }),
      db.signedTransaction.findUnique({
        where: { txHash },
        select: { userId: true, signerAddress: true },
      }),
    ]);
    if (!d) return;
    if (!signed) return;
    const distinctId = signed.userId ?? `wallet:${signed.signerAddress}`;
    const opts = signed && !signed.userId ? ({ personProfile: false } as const) : undefined;
    const signerAddress = signed?.signerAddress ?? null;
    if (outcome === "failed") {
      await captureServer(
        distinctId,
        "trigger_failed_onchain",
        { deployment_id: deploymentId, tx_hash: txHash, signer_address: signerAddress },
        opts,
      );
      return;
    }
    const pipeline = (d.pipelineSnapshot ?? []) as Array<{ templateKind?: string }>;
    await captureServer(
      distinctId,
      "trigger_confirmed",
      {
        deployment_id: deploymentId,
        tx_hash: txHash,
        signer_address: signerAddress,
        has_swap: pipeline.some((n) => n.templateKind === "SWAPPER"),
      },
      opts,
    );
  } catch (err) {
    log.warn({ err, deploymentId, txHash }, "tx-status: analytics capture failed");
  }
}

async function GETHandler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { id } = await ctx.params;
    const ip = clientIp(req);
    // IP-wide first, and deliberately NOT keyed on `id`: the route is public, so
    // a caller who varies the deployment id would otherwise get a fresh bucket
    // per request and never hit a limit at all.
    //
    // Loose on purpose. This bucket exists to stop that amplification, not to be
    // fair between pollers — the per-deployment limit below does that. Everyone
    // behind one NAT shares this one, and a demo-booth wifi or a carrier's CGNAT
    // is exactly the sandbox audience; a dev-mode payroll save also polls every
    // returned hash in parallel from a single browser. 600/min is about twenty
    // concurrent pollers at the hook's 2s interval, and still caps a single
    // address at 10 req/s of work that no longer touches the database unless the
    // transaction has confirmed.
    await enforceRateLimit({ key: `tx-status:ip:${ip}`, limit: 600, windowSeconds: 60 });
    await enforceRateLimit({ key: `tx-status:${id}:${ip}`, limit: 60, windowSeconds: 60 });

    const { searchParams } = new URL(req.url);
    const parsed = QuerySchema.safeParse({ txHash: searchParams.get("txHash") });
    if (!parsed.success) throw new AppError("VALIDATION", "Missing or invalid txHash");

    const { txHash } = parsed.data;

    const server = sorobanRpc();
    const lookupStartedAt = Date.now();
    const got = await server.getTransaction(txHash).catch(() => {
      log.warn(
        {
          operation: "getTransaction",
          category: "upstream",
          elapsedMs: Math.max(0, Date.now() - lookupStartedAt),
        },
        "Transaction status unavailable; original hash retained",
      );
      throw new AppError(
        "UPSTREAM_RPC",
        "Cannot determine transaction finality; check the original transaction hash again",
      );
    });

    if (got.status === "SUCCESS") {
      await recordTransactionOutcome(txHash, "CONFIRMED", {
        ledger: got.ledger,
        deploymentId: id,
        executionOnly: true,
      });
      // The status answer above is public chain data — the caller already holds
      // the hash and could ask the Soroban RPC directly — so it is not gated.
      // What has to be bound to this deployment is the bookkeeping below, above
      // all `recordAllowanceEvent`: it derives a ContractEvent from whatever
      // envelope the hash resolves to and publishes it to this deployment's SSE
      // channel, so an unbound caller could inject a fabricated ALLOWANCE event
      // into someone else's live feed.
      //
      // The audit row this reads is a best-effort write, so a lost row costs the
      // fast ingest and nothing else: the cron poller picks the same events up
      // within the minute. That is the whole penalty for guessing wrong here,
      // which is why this gates the side effects rather than the response.
      //
      // For the same reason the lookup itself may not throw: a database blip on
      // the one SUCCESS poll would otherwise 500, and the hook reports any
      // non-OK response as "Failed to check transaction status" for a
      // transaction that confirmed. Every other database touch below is
      // swallowed; this one has to be too.
      //
      // Claimed before the lookup, not after: `wasTxSubmittedFor` is a JSON-path
      // read of AuditLog (#435), and a repeat poll should not pay for it either.
      // The key carries the deployment id, so a poll against the wrong
      // deployment claims nothing the right one needs.
      const claim = await claimOutcome(id, txHash, "confirmed");
      if (claim === "taken") {
        return NextResponse.json({ data: { status: "SUCCESS", txHash } });
      }
      const submittedHere = await wasTxSubmittedFor(id, txHash).then(
        async (submitted) => {
          await keepOutcome(claim, id, txHash, "confirmed");
          return submitted;
        },
        async (err) => {
          log.warn(
            { err, deploymentId: id, txHash },
            "tx-status: submit lookup failed, leaving ingest to the cron poller",
          );
          await releaseOutcome(claim, id, txHash, "confirmed");
          return false;
        },
      );

      if (submittedHere) {
        invalidateDashboardBalances(id, txHash);
        await audit({
          action: "DEPLOY_TRIGGER_CONFIRMED",
          ip,
          metadata: { deploymentId: id, txHash },
        });
        void captureTriggerOutcome(id, txHash, "confirmed");

        // Pull this transaction's contract events into the store now, so the
        // deployment page the user opens next renders them from the database
        // instead of waiting up to a minute for the cron poller.
        const ingested = (
          remainingInteractiveRpcMs() > 0
            ? withIndependentEventRpcBudget(() => pollEventsFor(id))
            : Promise.resolve()
        ).catch((err) => {
          // Caught on the poll itself, not just on the race, so a rejection that
          // lands after the deadline is still handled.
          log.warn({ err, deploymentId: id, txHash }, "tx-status: event ingestion failed");
        });

        let deadline: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          ingested,
          new Promise<void>((resolve) => {
            deadline = setTimeout(() => {
              log.warn(
                { deploymentId: id, txHash },
                "tx-status: event ingestion deadline hit, leaving it to the cron poller",
              );
              resolve();
            }, remainingInteractiveRpcMs(EVENT_INGEST_DEADLINE_MS));
          }),
        ]);
        clearTimeout(deadline);

        const envelopeXdr =
          typeof got.envelopeXdr === "string" ? got.envelopeXdr : got.envelopeXdr?.toXDR("base64");
        if (envelopeXdr) {
          try {
            // The graph only supplies the asset's symbol, and the claim above
            // means this runs once: a failed read costs the label, not the event.
            const deployment = await db.deployment
              .findUnique({ where: { id }, select: { graphSnapshot: true } })
              .catch(() => null);
            const graph = (deployment?.graphSnapshot ?? null) as FlowGraph | null;
            await recordAllowanceEvent({
              deploymentId: id,
              envelopeXdr,
              txHash,
              ledger: got.ledger,
              // `createdAt` is the ledger close time in Unix seconds. There is no
              // `ledgerClosedAt` on a getTransaction response — that field belongs
              // to the getEvents shape — so reading it only ever produced the
              // fallback, and occurredAt recorded ingestion time instead.
              occurredAt: new Date(got.createdAt * 1000),
              graph,
            });
          } catch {
            // Never fail the status check because of synthetic event bookkeeping.
          }
        }
      }

      return NextResponse.json({ data: { status: "SUCCESS", txHash } });
    }

    if (got.status === "FAILED") {
      await recordTransactionOutcome(txHash, "FAILED", {
        ledger: got.ledger,
        failureCode: "ONCHAIN_FAILED",
        deploymentId: id,
        executionOnly: true,
      });
      // Unlike the SUCCESS branch this reads nothing that a stranger's hash
      // could pollute, but only a hash we submitted says something about Paiflow.
      const claim = await claimOutcome(id, txHash, "failed");
      if (claim !== "taken") {
        const submittedHere = await wasTxSubmittedFor(id, txHash).then(
          async (submitted) => {
            await keepOutcome(claim, id, txHash, "failed");
            return submitted;
          },
          async () => {
            await releaseOutcome(claim, id, txHash, "failed");
            return false;
          },
        );
        if (submittedHere) void captureTriggerOutcome(id, txHash, "failed");
      }
      return NextResponse.json({
        data: { status: "FAILED", txHash, errorMessage: "Transaction failed on the network" },
      });
    }

    // NOT_FOUND or other intermediate states → still pending
    return NextResponse.json({ data: { status: "PENDING", txHash } });
  });
}

export const GET = deploymentServiceRoute(
  (req, ctx) => withInteractiveRpcBudget(() => GETHandler(req, ctx)),
  "public",
);
