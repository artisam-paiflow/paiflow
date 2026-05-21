import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const enc = new TextEncoder();

function sseLine(event: string, data: unknown): Uint8Array {
  return enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireSession().catch(() => null);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { id } = await ctx.params;
  const deployment = await db.deployment.findFirst({
    where: { id, ownerId: user.id },
    select: { id: true, contractAddress: true },
  });
  if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(sseLine("hello", { id: deployment.id }));

      // Replay the last 50 stored events, establish cursor
      const past = await db.contractEvent.findMany({
        where: { deploymentId: deployment.id },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        take: 50,
      });
      for (const e of past) {
        controller.enqueue(
          sseLine("event", {
            id: e.id,
            kind: e.kind,
            ledger: e.ledger,
            txHash: e.txHash,
            payload: e.payload,
            decodedData: e.decodedData,
            occurredAt: e.occurredAt.toISOString(),
          }),
        );
      }

      // Composite cursor: (occurredAt, id) — handles same-timestamp events
      const last = past.at(-1);
      let lastAt: Date | null = last?.occurredAt ?? null;
      let lastId: string = last?.id ?? "";

      const DB_POLL_INTERVAL = 5_000;
      let dbInterval: NodeJS.Timeout | null = null;

      const pollDb = async () => {
        if (!lastAt) return;
        try {
          const newer = await db.contractEvent.findMany({
            where: {
              deploymentId: deployment.id,
              OR: [
                { occurredAt: { gt: lastAt } },
                {
                  AND: [{ occurredAt: { equals: lastAt } }, { id: { gt: lastId } }],
                },
              ],
            },
            orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
            take: 50,
          });
          for (const e of newer) {
            controller.enqueue(
              sseLine("event", {
                id: e.id,
                kind: e.kind,
                ledger: e.ledger,
                txHash: e.txHash,
                payload: e.payload,
                decodedData: e.decodedData,
                occurredAt: e.occurredAt.toISOString(),
              }),
            );
            lastAt = e.occurredAt;
            lastId = e.id;
          }
        } catch {
          /* stream closed */
        }
      };

      dbInterval = setInterval(pollDb, DB_POLL_INTERVAL);

      // Keepalive ping every 25s (prevents proxy timeouts)
      let pingInterval: NodeJS.Timeout | null = null;
      pingInterval = setInterval(() => {
        try {
          controller.enqueue(sseLine("ping", { t: Date.now() }));
        } catch {
          /* closed */
        }
      }, 25_000);

      const cleanup = () => {
        if (dbInterval) clearInterval(dbInterval);
        if (pingInterval) clearInterval(pingInterval);
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      };
      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
