import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sorobanRpc } from "@/lib/stellar/client";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { pollEventsFor, recordAllowanceEvent } from "@/lib/stellar/events";
import type { FlowGraph } from "@/lib/flows/schema";

const QuerySchema = z.object({
  txHash: z.string().min(1),
});

// `sorobanRpc()` sets no HTTP timeout and the SDK default is "never", so a
// stalled getEvents would hold this response open past the client's finality
// budget. Ingestion is best-effort — the cron poller re-runs whatever the
// deadline cut short — so the status answer never waits longer than this.
const EVENT_INGEST_DEADLINE_MS = 5_000;

/**
 * The `AuditLog.action` values written when this app submits a transaction for
 * a deployment: `submit-trigger` (DEPLOY_TRIGGER), `submit-invoke`
 * (DEPLOY_INVOKE) and `submit` (DEPLOY_CONFIRM). Each writes
 * `metadata: { deploymentId, txHash }`, which is what makes the pair lookup
 * below possible without a new column. The first two are what
 * `usePollTxStatus` actually polls today; DEPLOY_CONFIRM is listed so the
 * deploy transaction stays answerable rather than 404ing if a caller asks.
 */
const POLLABLE_SUBMIT_ACTIONS = ["DEPLOY_TRIGGER", "DEPLOY_INVOKE", "DEPLOY_CONFIRM"];

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { id } = await ctx.params;
    const ip = clientIp(req);
    await enforceRateLimit({ key: `tx-status:${id}:${ip}`, limit: 60, windowSeconds: 60 });

    const { searchParams } = new URL(req.url);
    const parsed = QuerySchema.safeParse({ txHash: searchParams.get("txHash") });
    if (!parsed.success) throw new AppError("VALIDATION", "Missing or invalid txHash");

    const { txHash } = parsed.data;

    // Bind the hash to the deployment before touching the network. Nothing else
    // in this route uses `id` for anything but the audit row and the event
    // ingest, so without this an unauthenticated caller could ask about any
    // hash at all and, worse, make us run `pollEventsFor` for a deployment they
    // have nothing to do with. Every submit path that is later polled records
    // the pair, so "we submitted this tx for this deployment" is the check —
    // and it is one a public `/trigger/:id` payer with no session can pass.
    const claimed = await db.auditLog.findFirst({
      where: {
        action: { in: POLLABLE_SUBMIT_ACTIONS },
        AND: [
          { metadata: { path: ["deploymentId"], equals: id } },
          { metadata: { path: ["txHash"], equals: txHash } },
        ],
      },
      select: { id: true },
    });
    if (!claimed) throw new AppError("NOT_FOUND", "Unknown transaction for this deployment");

    const server = sorobanRpc();
    const got = await server.getTransaction(txHash);

    if (got.status === "SUCCESS") {
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
