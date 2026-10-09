import "server-only";
import { assertDeploymentService } from "@/lib/deployments/service-work";
import { deploymentEventStreams } from "@/lib/deployment-event-streams";
import { log } from "@/lib/log";
import { eventChannel } from "@/lib/redis";
import { isShuttingDown } from "@/lib/server-shutdown";

export function deploymentEventResponse(
  id: string,
  signal: AbortSignal,
  poll: () => Promise<unknown>,
): Response {
  if (isShuttingDown()) return new Response("Server shutting down", { status: 503 });
  const manager = deploymentEventStreams();
  const encoder = new TextEncoder();
  let dispose = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let disposed = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let release: (() => void) | undefined;
      dispose = () => {
        if (disposed) return;
        disposed = true;
        clearInterval(heartbeat);
        signal.removeEventListener("abort", dispose);
        release?.();
        try {
          controller.close();
        } catch {
          /* reader already cancelled */
        }
      };
      const send = (data: string) => {
        if (disposed) return;
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          dispose();
        }
      };
      signal.addEventListener("abort", dispose, { once: true });
      if (signal.aborted || !manager) {
        dispose();
        return;
      }
      release = manager.join(eventChannel(id), {
        ready() {
          if (disposed) return;
          heartbeat = setInterval(() => {
            void assertDeploymentService(id).then(() => send(": ping\n\n"), dispose);
          }, 25000);
          send(": ping\n\n");
          send(
            `event: connected\ndata: ${JSON.stringify({ type: "connected", deploymentId: id })}\n\n`,
          );
          if (!disposed)
            void poll().catch((err) => log.warn({ err, id }, "initial pollEventsFor failed"));
        },
        message(message) {
          if (disposed) return;
          try {
            // Retain the existing malformed-message guard and framing.
            const event: unknown = JSON.parse(message);
            if (
              event &&
              typeof event === "object" &&
              "type" in event &&
              event.type === "service-retiring"
            ) {
              dispose();
              return;
            }
            void assertDeploymentService(id).then(
              () => send(`event: message\ndata: ${JSON.stringify(event)}\n\n`),
              dispose,
            );
          } catch {
            /* ignore malformed messages */
          }
        },
        close: dispose,
      });
      // join may call ready/close synchronously; release that registration too.
      if (disposed) release();
    },
    cancel() {
      dispose();
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
