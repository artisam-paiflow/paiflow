import "server-only";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { eventProperties } from "./event-policy";
import { analyticsContext } from "./context";
import type { EventMap, EventName } from "./events";
import { analyticsEventId } from "./event-id";
const CAPTURE_TIMEOUT_MS = 2_000;
/** Only approved product properties and server-produced context reach PostHog. */
export async function deliverAnalytics(input: {
  id?: string;
  distinctId: string;
  name: string;
  properties: Record<string, unknown>;
  occurredAt: Date;
  personProfile: boolean;
}): Promise<boolean> {
  try {
    const e = env();
    if (!e.NEXT_PUBLIC_POSTHOG_KEY) return false;
    const props = eventProperties(input.name, input.properties);
    if (!props) return false;
    const context: Record<string, unknown> = {};
    for (const key of [
      "audience",
      "stellar_network",
      "app_env",
      "app_version",
      "app_host",
      "tracking_version",
      "account_id",
      "caller_type",
    ]) {
      if (typeof input.properties[key] === "string") context[key] = input.properties[key];
    }
    const response = await fetch(`${e.POSTHOG_HOST}/i/v0/e/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: e.NEXT_PUBLIC_POSTHOG_KEY,
        event: input.name,
        distinct_id: input.distinctId,
        timestamp: input.occurredAt.toISOString(),
        properties: {
          ...props,
          ...context,
          source: "server",
          $geoip_disable: true,
          $ip: null,
          $process_person_profile: input.personProfile,
          ...(input.id ? { $insert_id: input.id } : {}),
        },
      }),
      signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
    });
    if (!response.ok)
      log.warn({ event: input.name, status: response.status }, "analytics: capture rejected");
    return response.ok;
  } catch {
    log.warn({ event: input.name }, "analytics: capture failed");
    return false;
  }
}
export async function captureServer<E extends EventName>(
  distinctId: string,
  name: E,
  props: EventMap[E],
  opts?: { personProfile?: false; deduplicationId?: string },
): Promise<void> {
  if (!env().NEXT_PUBLIC_POSTHOG_KEY) return;
  try {
    const context = await analyticsContext(/^[0-9a-f-]{36}$/i.test(distinctId) ? distinctId : null);
    const txHash = "tx_hash" in props ? props.tx_hash : undefined;
    const id =
      opts?.deduplicationId ??
      (typeof txHash === "string" ? `${context.stellar_network}:${name}:${txHash}` : undefined);
    await deliverAnalytics({
      id: id ? analyticsEventId(id) : undefined,
      distinctId,
      name,
      properties: { ...props, ...context },
      occurredAt: new Date(),
      personProfile: opts?.personProfile !== false,
    });
  } catch {
    log.warn({ event: name }, "analytics: context unavailable");
  }
}
