import { NextRequest } from "next/server";
import { AppError, withErrorHandler } from "@/lib/errors";
import { clientIp, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { eventChannel } from "@/lib/redis";
import { publicEmbedDeployment, publicEmbedEvents } from "@/lib/deployments/public-embed-reads";
import {
  acquirePublicStreamSlot,
  PUBLIC_STREAM_LIFETIME_MS,
} from "@/lib/deployments/public-stream-slots";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { id } = await ctx.params;
    await publicEmbedDeployment(req, id);
    const ip = clientIp(req);
    const limit = await rateLimit(`public-embed:connect:${ip}`, 120, 60);
    if (!limit.ok)
      throw new AppError(
        "RATE_LIMITED",
        "Too many connections",
        undefined,
        undefined,
        retryAfterSeconds(limit),
      );
    const slot = await acquirePublicStreamSlot(ip, id);
    if (!slot)
      return new Response("Live stream temporarily unavailable", {
        status: 503,
        headers: { "Retry-After": "15" },
      });

    const sub = slot.client.duplicate({
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    const channel = eventChannel(id);
    let closed = false;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let interval: ReturnType<typeof setInterval> | undefined;
    let lifetime: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    let dirty = false;
    const encoder = new TextEncoder();
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(interval);
      clearTimeout(lifetime);
      req.signal.removeEventListener("abort", close);
      sub.removeAllListeners();
      sub.disconnect();
      void slot.release();
      try {
        controller?.close();
      } catch {
        /* Already cancelled. */
      }
    };
    const send = (data: string) => {
      if (closed) return;
      // Bound queued data for clients that stop reading.
      if ((controller.desiredSize ?? 0) <= 0) {
        close();
        return;
      }
      controller.enqueue(encoder.encode(data));
    };
    const refresh = async () => {
      if (closed) return;
      if (busy) {
        dirty = true;
        return;
      }
      busy = true;
      try {
        const events = await publicEmbedEvents(id);
        send(`event: snapshot\ndata: ${JSON.stringify({ events })}\n\n`);
      } catch {
        close();
      } finally {
        busy = false;
        if (dirty && !closed) {
          dirty = false;
          void refresh();
        }
      }
    };
    const stream = new ReadableStream<Uint8Array>(
      {
        start(c) {
          controller = c;
          req.signal.addEventListener("abort", close, { once: true });
          lifetime = setTimeout(close, PUBLIC_STREAM_LIFETIME_MS);
          if (req.signal.aborted) {
            close();
            return;
          }
          sub.on("error", close);
          sub.on("close", close);
          // Redis only signals a refresh. Its unrestricted payload never reaches a viewer.
          sub.on("message", (ch: string) => {
            if (ch === channel) void refresh();
          });
          void (async () => {
            try {
              await sub.connect();
              if (closed) return;
              await sub.subscribe(channel);
              if (closed) return;
              send("retry: 10000\nevent: connected\ndata: {}\n\n");
              // Subscribe before catch-up to close the SSR/connect race.
              await refresh();
              if (!closed)
                interval = setInterval(() => {
                  send(": ping\n\n");
                  void refresh();
                }, 15_000);
            } catch {
              close();
            }
          })();
        },
        cancel: close,
      },
      { highWaterMark: 16 },
    );
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  });
}
