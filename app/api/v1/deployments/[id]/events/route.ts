import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { decodeCursor, encodeCursor } from "@/lib/api/v1/cursor";
import { refreshEventsIfStale } from "@/lib/api/v1/events-freshness";
import {
  ListEventsQuerySchema,
  type ContractEventItem,
  type ListEventsResponse,
} from "@/lib/api/v1/schema";

export const dynamic = "force-dynamic";

const invalidCursor = () =>
  new AppError("VALIDATION", "Invalid cursor", { cursor: ["Invalid cursor"] });

function parseCursor(cursor: string): { ledger: number; eventId: string } {
  const parts = decodeCursor(cursor);
  if (!parts || !/^\d+$/.test(parts.head)) throw invalidCursor();
  const ledger = Number(parts.head);
  if (!Number.isSafeInteger(ledger)) throw invalidCursor();
  return { ledger, eventId: parts.tail };
}

function firstTopic(payload: Prisma.JsonValue): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const topics = payload.topics;
  return Array.isArray(topics) && typeof topics[0] === "string" ? topics[0] : null;
}

/**
 * Forward-paginated contract events for one deployment, ascending by `(ledger, eventId)`.
 *
 * Serves the app's `ContractEvent` record: `eventId` is unique, so a partner never sees a
 * duplicate. Rows arrive from the one-minute `cron/poll-events` run and the execute submit path;
 * so that a payment Paiflow did not submit (a wallet paying the contract directly, a scanned SEP-7
 * QR, a relayer action) does not wait for the cron, a read whose deployment cursor is older than
 * `EVENTS_STALE_AFTER_MS` polls RPC first (`refreshEventsIfStale`). That poll is throttled per
 * deployment, not per caller, so a tight polling loop still costs about one indexed query per call.
 */
export const GET = v1Route({ rateLimit: V1_RATE_LIMITS.events }, async ({ req, deployment }) => {
  // Empty values are validated, not dropped: `?cursor=` from an unset client variable must be a
  // 422, never a silent restart from the first event.
  const query = ListEventsQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const after = query.cursor ? parseCursor(query.cursor) : null;

  // After validation, so a malformed request never reaches RPC. `pollEventsFor` makes the same
  // check, but skipping here also skips the cursor read and the refresh claim.
  if (deployment.status === "CONFIRMED" && deployment.contractAddress) {
    await refreshEventsIfStale(deployment.id);
  }

  const rows = await db.contractEvent.findMany({
    where: {
      deploymentId: deployment.id,
      ...(query.txHash ? { txHash: query.txHash } : {}),
      ...(after
        ? {
            OR: [
              { ledger: { gt: after.ledger } },
              { ledger: after.ledger, eventId: { gt: after.eventId } },
            ],
          }
        : {}),
    },
    orderBy: [{ ledger: "asc" }, { eventId: "asc" }],
    take: query.limit + 1,
    select: {
      id: true,
      eventId: true,
      kind: true,
      ledger: true,
      txHash: true,
      occurredAt: true,
      payload: true,
      decodedData: true,
    },
  });

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];

  const items: ContractEventItem[] = page.map((row) => ({
    id: row.id,
    eventId: row.eventId,
    kind: row.kind,
    topic: firstTopic(row.payload),
    ledger: row.ledger,
    txHash: row.txHash,
    occurredAt: row.occurredAt.toISOString(),
    data: row.decodedData,
  }));

  const body: ListEventsResponse = {
    items,
    // Kept on an empty last page so the caller can poll the tail with the cursor it holds.
    nextCursor: last ? encodeCursor(String(last.ledger), last.eventId) : (query.cursor ?? null),
    hasMore,
  };
  return NextResponse.json({ data: body });
});
