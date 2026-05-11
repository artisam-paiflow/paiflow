import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { redisSub, eventChannel } from "@/lib/redis";

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

      // Replay the last 50 stored events
      const past = await db.contractEvent.findMany({
        where: { deploymentId: deployment.id },
        orderBy: { occurredAt: "desc" },
        take: 50,
      });
      for (const e of past.reverse()) {
        controller.enqueue(
          sseLine("event", {
            id: e.id,
            kind: e.kind,
            ledger: e.ledger,
            txHash: e.txHash,
            payload: e.payload,
            occurredAt: e.occurredAt.toISOString(),
          }),
        );
      }

      const sub = redisSub();
      let unsubscribed = false;
      let interval: NodeJS.Timeout | null = null;

      const onMessage = (channel: string, message: string) => {
        if (channel !== eventChannel(deployment.id)) return;
        try {
          controller.enqueue(sseLine("event", JSON.parse(message)));
        } catch {
          /* ignore malformed */
        }
      };

      if (sub) {
        await sub.subscribe(eventChannel(deployment.id));
        sub.on("message", onMessage);
      }

      interval = setInterval(() => {
        try {
          controller.enqueue(sseLine("ping", { t: Date.now() }));
        } catch {
          /* closed */
        }
      }, 25_000);

      const cleanup = () => {
        if (unsubscribed) return;
        unsubscribed = true;
        if (interval) clearInterval(interval);
        if (sub) {
          sub.off("message", onMessage);
          sub.unsubscribe(eventChannel(deployment.id)).catch(() => undefined);
        }
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
