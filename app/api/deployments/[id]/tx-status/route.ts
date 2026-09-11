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

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { id } = await ctx.params;
    const ip = clientIp(req);
    // IP-wide first, and deliberately NOT keyed on `id`: the route is public, so
    // a caller who varies the deployment id would otherwise get a fresh bucket
    // per request and never hit a limit at all. The per-deployment limit below
    // stays as a second control on a single deployment's pollers. 120/min is
    // about four concurrent tabs at the hook's 2s interval.
    await enforceRateLimit({ key: `tx-status:ip:${ip}`, limit: 120, windowSeconds: 60 });
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
      if (await wasTxSubmittedFor(id, txHash)) {
        await audit({
          action: "DEPLOY_TRIGGER_CONFIRMED",
          ip,
          metadata: { deploymentId: id, txHash },
        });

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
              occurredAt: new Date((got as any).ledgerClosedAt ?? Date.now()),
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
      return NextResponse.json({
        data: { status: "FAILED", txHash, errorMessage: "Transaction failed on the network" },
      });
    }

    // NOT_FOUND or other intermediate states → still pending
    return NextResponse.json({ data: { status: "PENDING", txHash } });
  });
}
