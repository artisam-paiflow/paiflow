import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { v1Route } from "@/lib/api/v1/handler";
import { decodeCursor, encodeCursor } from "@/lib/api/v1/cursor";
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
 * Reads the app's `ContractEvent` record, never Soroban RPC: `eventId` is unique, so a partner
 * never sees a duplicate, and a tight polling loop costs one indexed query. Rows arrive from the
 * one-minute `cron/poll-events` run (and the execute submit path), so the feed can trail the chain
 * by about a minute.
 */
export const GET = v1Route(
  { rateLimit: { limit: 120, windowSeconds: 60 } },
  async ({ req, deployment }) => {
    // Empty values are validated, not dropped: `?cursor=` from an unset client variable must be a
    // 422, never a silent restart from the first event.
    const query = ListEventsQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const after = query.cursor ? parseCursor(query.cursor) : null;

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
  },
);
