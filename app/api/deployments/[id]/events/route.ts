import { log } from "@/lib/log";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { redisSub, eventChannel } from "@/lib/redis";
import { AppError } from "@/lib/errors";
import { pollEventsFor } from "@/lib/stellar/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireSession().catch(() => null);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await ctx.params;
  const deployment = await db.deployment.findFirst({
    where: { id, ownerId: user.id },
    select: { id: true },
  });
  if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");

  const encoder = new TextEncoder();
  let subscribed = false;
  let aborted = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          /* stream already closed */
        }
      };

      const sendEvent = (event: object, eventType = "message") => {
        send(`event: ${eventType}\ndata: ${JSON.stringify(event)}\n\n`);
      };

      const ping = () => send(": ping\n\n");

      let pingInterval: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        aborted = true;
        if (pingInterval) clearInterval(pingInterval);
      };

      const closeStream = () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const sub = redisSub();
      if (!sub) {
        closeStream();
        return;
      }

      const channel = eventChannel(id);

      // The global subscriber singleton may be reconnecting. Wait until it is
      // ready before issuing SUBSCRIBE; otherwise ioredis rejects the command
      // because enableOfflineQueue is false.
      if (sub.status !== "ready") {
        try {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("Redis subscriber connection timeout")),
              5000,
            );
            const onReady = () => {
              clearTimeout(timeout);
              cleanupListeners();
              resolve();
            };
            const onError = (err: Error) => {
              clearTimeout(timeout);
              cleanupListeners();
              reject(err);
            };
            const cleanupListeners = () => {
              sub.off("ready", onReady);
              sub.off("error", onError);
            };
            sub.once("ready", onReady);
            sub.once("error", onError);
          });
        } catch (err) {
          log.warn({ err, channel }, "SSE redis connection failed");
          closeStream();
          return;
        }
      }

      if (aborted) return;

      // Close the SSE stream if Redis drops after we subscribed.
      sub.on("error", (err) => {
        log.warn({ err, channel }, "SSE redis error");
        closeStream();
      });
      sub.on("close", () => {
        if (!aborted) closeStream();
      });

      sub.subscribe(channel, (err) => {
        if (err) {
          log.warn({ err, channel }, "SSE redis subscribe failed");
          closeStream();
          return;
        }

        subscribed = true;

        pingInterval = setInterval(() => {
          if (!aborted) ping();
        }, 15000);

        // Catch any events that arrived between SSR and SSE connect.
        pollEventsFor(id).catch((err) => {
          log.warn({ err, id }, "initial pollEventsFor failed");
        });

        sendEvent({ type: "connected", deploymentId: id }, "connected");
      });

      sub.on("message", (ch, msg) => {
        if (ch !== channel || aborted) return;
        try {
          const event = JSON.parse(msg);
          sendEvent(event);
        } catch {
          /* ignore malformed messages */
        }
      });

      req.signal.addEventListener("abort", () => {
        cleanup();
        if (subscribed) {
          sub.unsubscribe(channel).catch(() => null);
        }
        closeStream();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
