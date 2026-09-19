import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sorobanRpc } from "@/lib/stellar/client";
import { AppError, withErrorHandler } from "@/lib/errors";
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

// `sorobanRpc()` sets no HTTP timeout and the SDK default is "never", so a
// stalled getEvents would hold this response open past the client's finality
// budget. Ingestion is best-effort — the cron poller re-runs whatever the
// deadline cut short — so the status answer never waits longer than this.
const EVENT_INGEST_DEADLINE_MS = 5_000;

// The status route is public, so the caller has no session to attribute a
// trigger to. The `SignedTransaction` row written at submit says who signed:
// its user when the signer was signed in, else the wallet itself with no
// person profile. Only a transaction from before signers were recorded falls
// back to the deployment's owner, who is not necessarily the signer.
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
type Outcome = "confirmed" | "failed";

function outcomeClaimKey(deploymentId: string, txHash: string, outcome: Outcome): string {
  return `analytics:trigger:${deploymentId}:${txHash}:${outcome}`;
}

async function claimOutcome(
  deploymentId: string,
  txHash: string,
  outcome: Outcome,
): Promise<boolean> {
  const client = redis();
  if (!client) return true;
  try {
    const claimed = await client.set(
      outcomeClaimKey(deploymentId, txHash, outcome),
      "1",
      "EX",
      OUTCOME_CLAIM_TTL_SECONDS,
      "NX",
    );
    return claimed === "OK";
  } catch (err) {
    log.warn(
      { err, deploymentId, txHash },
      "tx-status: outcome claim failed, proceeding unclaimed",
    );
    return true;
  }
}

// Only for a claim whose work never started, so the next poll can retry it.
async function releaseOutcome(deploymentId: string, txHash: string, outcome: Outcome) {
  await redis()
    ?.del(outcomeClaimKey(deploymentId, txHash, outcome))
    .catch(() => null);
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
    const distinctId = signed?.userId ?? (signed ? `wallet:${signed.signerAddress}` : d.ownerId);
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

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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
    const got = await server.getTransaction(txHash);

    if (got.status === "SUCCESS") {
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
      if (!(await claimOutcome(id, txHash, "confirmed"))) {
        return NextResponse.json({ data: { status: "SUCCESS", txHash } });
      }
      const submittedHere = await wasTxSubmittedFor(id, txHash).catch(async (err) => {
        log.warn(
          { err, deploymentId: id, txHash },
          "tx-status: submit lookup failed, leaving ingest to the cron poller",
        );
        await releaseOutcome(id, txHash, "confirmed");
        return false;
      });

      if (submittedHere) {
        await audit({
          action: "DEPLOY_TRIGGER_CONFIRMED",
          ip,
          metadata: { deploymentId: id, txHash },
        });
        void captureTriggerOutcome(id, txHash, "confirmed");

        // Pull this transaction's contract events into the store now, so the
        // deployment page the user opens next renders them from the database
        // instead of waiting up to a minute for the cron poller.
        const ingested = pollEventsFor(id).catch((err) => {
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
            }, EVENT_INGEST_DEADLINE_MS);
          }),
        ]);
        clearTimeout(deadline);

        const envelopeXdr = (got as any).envelopeXdr as string | undefined;
        if (envelopeXdr) {
          try {
            const deployment = await db.deployment.findUnique({
              where: { id },
              select: { graphSnapshot: true },
            });
            const graph = deployment?.graphSnapshot as FlowGraph | null;
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
      // Unlike the SUCCESS branch this reads nothing that a stranger's hash
      // could pollute, but only a hash we submitted says something about Paiflow.
      if (
        (await claimOutcome(id, txHash, "failed")) &&
        (await wasTxSubmittedFor(id, txHash).catch(async () => {
          await releaseOutcome(id, txHash, "failed");
          return false;
        }))
      ) {
        void captureTriggerOutcome(id, txHash, "failed");
      }
      return NextResponse.json({
        data: { status: "FAILED", txHash, errorMessage: "Transaction failed on the network" },
      });
    }

    // NOT_FOUND or other intermediate states → still pending
    return NextResponse.json({ data: { status: "PENDING", txHash } });
  });
}
