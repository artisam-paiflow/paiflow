import type { PostHog } from "posthog-js";
import type { EventMap, EventName } from "./events";
import { redactString, sanitizeProps } from "./sanitize";

/**
 * Browser-side analytics. Everything here is a no-op unless the build carries
 * `NEXT_PUBLIC_POSTHOG_KEY`, which only the beta Railway service sets; local
 * dev, tests and paiflow.xyz never load posthog-js at all.
 *
 * posthog-js is dynamically imported so it stays out of every route's initial
 * bundle (CLAUDE.md §11). Events tracked before it finishes loading are queued.
 */

// Same-origin proxy (app/ingest/[...path]/route.ts): keeps the CSP at 'self'
// and survives Brave's default tracker blocking, which the alpha guide supports.
const API_HOST = "/ingest";
const UI_HOST = "https://us.posthog.com";

let client: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;
const queue: Array<[string, Record<string, unknown>]> = [];

// Replays mask every text node, not just inputs: the one-time API token, the
// curl command and Stellar addresses render as plain text, and a snapshot is
// not something before_send can redact.
export const SESSION_RECORDING = { maskAllInputs: true, maskTextSelector: "*" } as const;

export function analyticsEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);
}

function redactDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactString(value);
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactDeep(v, depth + 1)]),
  );
}

export function loadAnalytics(): Promise<PostHog | null> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || typeof window === "undefined") return Promise.resolve(null);
  if (loading) return loading;

  loading = (async () => {
    const [{ default: posthog }] = await Promise.all([
      import("posthog-js"),
      // Bundled rather than fetched from PostHog's CDN at runtime: with
      // `disable_external_dependency_loading` nothing but /ingest is contacted.
      import("posthog-js/dist/recorder"),
      import("posthog-js/dist/exception-autocapture"),
      import("posthog-js/dist/dead-clicks-autocapture"),
    ]);
    posthog.init(key, {
      api_host: API_HOST,
      ui_host: UI_HOST,
      person_profiles: "identified_only",
      // App Router navigations don't reload the page; AnalyticsProvider sends
      // $pageview on every pathname change instead.
      capture_pageview: false,
      capture_pageleave: true,
      capture_exceptions: true,
      capture_dead_clicks: true,
      disable_external_dependency_loading: true,
      session_recording: SESSION_RECORDING,
      // Autocapture records element text, which on this app includes recipient
      // and contract addresses. Replay snapshots are left alone: they are
      // large, and SESSION_RECORDING already masks their text.
      before_send: (event) => {
        if (!event || event.event === "$snapshot") return event;
        return { ...event, properties: redactDeep(event.properties) as typeof event.properties };
      },
      loaded: (ph) => {
        ph.register({
          app_env: process.env.NEXT_PUBLIC_APP_ENV ?? "local",
          app_version: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
        });
      },
    });
    client = posthog;
    for (const [name, props] of queue.splice(0)) posthog.capture(name, props);
    return posthog;
  })().catch(() => null);

  return loading;
}

export function track<E extends EventName>(name: E, props: EventMap[E]): void {
  if (!analyticsEnabled()) return;
  const clean = sanitizeProps(props as Record<string, unknown>);
  if (client) {
    client.capture(name, clean);
    return;
  }
  // Bounded: if posthog-js fails to load, the queue must not grow for the tab's life.
  if (queue.length < 100) queue.push([name, clean]);
  void loadAnalytics();
}

export function analyticsClient(): PostHog | null {
  return client;
}
