import type { PostHog } from "posthog-js";
import type { EventMap, EventName } from "./events";
import { isAddressAllowedKey, redactString, sanitizeEntry, sanitizeProps } from "./sanitize";

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
// The User.id this page has told posthog-js about, or null. It gates person
// properties only: with `person_profiles: "identified_only"`,
// setPersonProperties on an anonymous visitor would create a profile, one per
// visitor to the public trigger page. It is not the identity state — that
// lives in posthog-js's own persistence and survives a reload, which this
// module-level variable does not (see `resetIdentity`).
let identifiedUserId: string | null = null;

export function analyticsEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);
}

/**
 * The `before_send` redaction, applied to every event posthog-js emits,
 * including autocaptured ones. It walks nested objects because person
 * properties travel inside `properties.$set` / `$set_once`; the key is
 * threaded down so an allowlisted name is honoured at any depth, and no
 * other name is — `$el_text` is not allowlisted at depth 0 or depth 3.
 */
export function redactDeep(value: unknown, key: string | null = null, depth = 0): unknown {
  if (key !== null && isAddressAllowedKey(key)) return sanitizeEntry(key, value);
  if (typeof value === "string") return redactString(value);
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, key, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, redactDeep(v, k, depth + 1)] as const)
      .filter(([, v]) => v !== undefined),
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
      // The replay recorder is deliberately absent — see disable_session_recording.
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
      // Session replay is off by decision (16 Sep 2026), belt and braces: the
      // recorder is not bundled, this flag stops posthog-js starting one, and
      // the project has session_recording_opt_in disabled. Any one of the three
      // is sufficient; all three mean a single change cannot silently restart
      // screen recording. homepage/privacy.html and the alpha testing guide
      // both state that we do not record, so this must stay off.
      disable_session_recording: true,
      // Autocapture records element text, which on this app includes recipient
      // and contract addresses. The $snapshot carve-out is kept as dead-code
      // defence: nothing emits snapshots now, and if replay were ever switched
      // back on, before_send could not usefully redact one anyway.
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

/** Tie this browser to a signed-in user. Idempotent per user id. */
export function identifyUser(userId: string, props: Record<string, unknown>): void {
  if (!analyticsEnabled() || identifiedUserId === userId) return;
  identifiedUserId = userId;
  void loadAnalytics().then((ph) => ph?.identify(userId, props));
}

/**
 * Nobody is signed in: the next person on this browser must not inherit an
 * id. Decided against posthog-js's persisted state, not `identifiedUserId`:
 * after a reload that variable is null while the cookie still carries the
 * previous user's distinct id, and an early return here would let every
 * later pageview and wallet event stay attributed to them. An anonymous
 * visitor is left alone, so their anonymous id is not churned per mount.
 */
export function resetIdentity(): void {
  if (!analyticsEnabled()) return;
  identifiedUserId = null;
  void loadAnalytics().then((ph) => {
    if (ph?._isIdentified()) ph.reset();
  });
}

/**
 * Person properties for the identified user; a no-op for an anonymous visitor
 * (see `identifiedUserId`). Goes through `loadAnalytics()` rather than
 * `analyticsClient()` because, unlike `track`, there is no queue to fall
 * back on before posthog-js has loaded. Values pass `sanitizeProps`, so an
 * address survives only on an allowlisted key.
 */
export function setPersonProps(
  props: Record<string, unknown>,
  once?: Record<string, unknown>,
): void {
  if (!analyticsEnabled() || !identifiedUserId) return;
  const cleanProps = sanitizeProps(props);
  const cleanOnce = once ? sanitizeProps(once) : undefined;
  void loadAnalytics().then((ph) => ph?.setPersonProperties(cleanProps, cleanOnce));
}

export function analyticsClient(): PostHog | null {
  return client;
}
