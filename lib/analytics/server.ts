import "server-only";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import type { EventMap, EventName } from "./events";
import { sanitizeProps } from "./sanitize";

const CAPTURE_TIMEOUT_MS = 2_000;

/**
 * Server-side capture for outcomes the browser can't be trusted to report:
 * confirmations and failures decided by the chain, and the cron timeout that
 * no page is open for. Plain `fetch` to PostHog's capture endpoint rather than
 * posthog-node, which would be a second dependency for one POST.
 *
 * Fire-and-forget: it resolves once the request settles, never throws, and a
 * caller should `void` it rather than make a response wait on analytics.
 */
export async function captureServer<E extends EventName>(
  distinctId: string,
  name: E,
  props: EventMap[E],
): Promise<void> {
  try {
    const e = env();
    if (!e.NEXT_PUBLIC_POSTHOG_KEY) return;
    const res = await fetch(`${e.POSTHOG_HOST}/i/v0/e/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: e.NEXT_PUBLIC_POSTHOG_KEY,
        event: name,
        distinct_id: distinctId,
        timestamp: new Date().toISOString(),
        properties: {
          ...sanitizeProps(props as Record<string, unknown>),
          app_env: e.NEXT_PUBLIC_APP_ENV,
          app_version: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
          stellar_network: e.STELLAR_NETWORK,
          source: "server",
        },
      }),
      signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
    });
    if (!res.ok) log.warn({ event: name, status: res.status }, "analytics: capture rejected");
  } catch (err) {
    log.warn(
      { event: name, error: err instanceof Error ? err.message : String(err) },
      "analytics: capture failed",
    );
  }
}
