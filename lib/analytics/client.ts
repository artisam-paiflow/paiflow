import type { PostHog } from "posthog-js";
import { classifyError } from "./classify-error";
import type { EventMap, EventName } from "./events";
import {
  browserEvent,
  personProperties,
  validateBrowserContext,
  type BrowserContext,
} from "./browser-policy";
import { CONTROL_SELECTORS } from "./policy";
import { eventProperties } from "./event-policy";
import { isAddressAllowedKey, redactString, sanitizeEntry } from "./sanitize";

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
const queue: Array<{ name: string; properties: Record<string, unknown>; generation: number }> = [];
let subject: string | null | undefined;
let generation = 0;
// The User.id this page has told posthog-js about, or null. It gates person
// properties only: with `person_profiles: "identified_only"`,
// setPersonProperties on an anonymous visitor would create a profile, one per
// visitor to the public trigger page. It is not the identity state — that
// lives in posthog-js's own persistence and survives a reload, which this
// module-level variable does not (see `resetIdentity`).
let identifiedUserId: string | null = null;
let context: BrowserContext | null = null;
export function setAnalyticsContext(value: unknown): void {
  context = validateBrowserContext(value);
}
/** undefined means session initialization is still pending. */
export function setAnalyticsSubject(userId: string | null | undefined): void {
  if (subject === userId) return;
  subject = userId;
  generation++;
  context = null;
  queue.length = 0;
}
export async function synchronizeAnalytics(
  userId: string | null,
  props: Record<string, unknown>,
  value: unknown,
  current: () => boolean,
): Promise<void> {
  if (!current()) return;
  if (subject === undefined) setAnalyticsSubject(userId);
  const origin = generation;
  const ph = await loadAnalytics();
  if (!ph || !current() || subject !== userId || origin !== generation) return;
  const nextContext = validateBrowserContext(value);
  if (!nextContext || nextContext.account_id !== (userId ?? "")) return;
  if (ph._isIdentified() && (!userId || identifiedUserId !== userId)) ph.reset();
  context = nextContext;
  identifiedUserId = userId;
  if (userId) ph.identify(userId, personProperties(props));
  for (const entry of queue.splice(0))
    if (entry.generation === generation) ph.capture(entry.name, entry.properties);
}

export function analyticsEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);
}

/**
 * Bounded redaction helper for existing callers. The SDK's final before_send
 * gate separately rebuilds every payload from the event/property allowlists.
 */
export function redactDeep(value: unknown, key: string | null = null, depth = 0): unknown {
  if (depth > 6) return undefined;
  if (key !== null && isAddressAllowedKey(key)) return sanitizeEntry(key, value);
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object")
    return typeof value === "number" && !Number.isFinite(value) ? undefined : value;
  if (Array.isArray(value))
    return value
      .slice(0, 100)
      .map((v) => redactDeep(v, key, depth + 1))
      .filter((v) => v !== undefined);
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
      capture_exceptions: false,
      capture_dead_clicks: true,
      disable_external_dependency_loading: true,
      // Session replay is off by decision (16 Sep 2026), belt and braces: the
      // recorder is not bundled, this flag stops posthog-js starting one, and
      // the project has session_recording_opt_in disabled. Any one of the three
      // is sufficient; all three mean a single change cannot silently restart
      // screen recording. homepage/privacy.html and the alpha testing guide
      // both state that we do not record, so this must stay off.
      disable_session_recording: true,
      // Individual approved controls only; before_send removes all DOM content.
      autocapture: {
        css_selector_allowlist: CONTROL_SELECTORS,
        element_allowlist: ["button", "a"],
        dom_event_allowlist: ["click"],
        element_attribute_ignorelist: ["aria-label", "title", "href", "value", "name"],
      },
      mask_all_text: true,
      mask_all_element_attributes: false,
      rageclick: true,
      before_send: (event) => {
        if (!event) return null;
        return browserEvent(event, window.location?.pathname ?? "/", context, key);
      },
    });
    client = posthog;
    return posthog;
  })().catch(() => null);

  return loading;
}

export function track<E extends EventName>(name: E, props: EventMap[E]): void {
  if (!analyticsEnabled()) return;
  const clean = eventProperties(name, props as Record<string, unknown>);
  if (!clean) return;
  if (client && context) {
    client.capture(name, clean);
    return;
  }
  // Bounded: if posthog-js fails to load, the queue must not grow for the tab's life.
  if (subject !== undefined && queue.length < 100)
    queue.push({ name, properties: clean, generation });
  void loadAnalytics();
}

/** Tie this browser to a signed-in user. Idempotent per user id. */
export function identifyUser(userId: string, props: Record<string, unknown>): void {
  if (!analyticsEnabled() || identifiedUserId === userId) return;
  setAnalyticsSubject(userId);
  identifiedUserId = userId;
  const origin = generation;
  void loadAnalytics().then((ph) => {
    if (origin === generation) ph?.identify(userId, personProperties(props));
  });
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
  setAnalyticsSubject(null);
  identifiedUserId = null;
  const origin = generation;
  void loadAnalytics().then((ph) => {
    if (origin === generation && ph?._isIdentified()) ph.reset();
  });
}

/**
 * Person properties for the identified user; a no-op for an anonymous visitor
 * (see `identifiedUserId`). Goes through `loadAnalytics()` rather than
 * `analyticsClient()` because, unlike `track`, there is no queue to fall
 * back on before posthog-js has loaded. Values pass `personProperties`, so an
 * address survives only on an allowlisted key.
 */
export function setPersonProps(
  props: Record<string, unknown>,
  once?: Record<string, unknown>,
): void {
  if (!analyticsEnabled() || !identifiedUserId || identifiedUserId !== subject) return;
  const cleanProps = personProperties(props);
  const cleanOnce = once ? personProperties(once) : undefined;
  const origin = generation;
  void loadAnalytics().then((ph) => {
    if (origin === generation) ph?.setPersonProperties(cleanProps, cleanOnce);
  });
}

export function analyticsClient(): PostHog | null {
  return client;
}

/** Structured diagnostics only; never send error messages or unrestricted stacks. */
export function trackException(
  error: unknown,
  stage: "runtime" | "unhandled_rejection" | "render",
) {
  const classified = classifyError(error);
  const frames =
    error instanceof Error
      ? [...(error.stack ?? "").matchAll(/\/_next\/static\/chunks\/[a-zA-Z0-9_.-]+\.js:\d+:\d+/g)]
          .map((m) => m[0])
          .slice(0, 8)
      : [];
  const diagnostic = {
    stage,
    error_class: classified.errorClass,
    error_code: classified.errorCode,
    frames,
  };
  const needsInitialCapture = subject === undefined;
  track("exception_captured", diagnostic);
  if (!context && analyticsEnabled()) {
    let origin = generation;
    void fetch("/api/audit/analytics-context")
      .then(async (response) => {
        if (!response.ok || context || origin !== generation) return;
        const body = await response.json();
        if (context || origin !== generation) return;
        const nextContext = validateBrowserContext(body.data);
        const userId = body.data?.subject_id ?? null;
        if (!nextContext || nextContext.account_id !== (userId ?? "")) return;
        if (subject === undefined) {
          // This fallback owns its initial identity adoption. Later identity changes
          // still invalidate the fetch and SDK load; ordinary unknown-session actions
          // are never replayed into this authoritative account.
          setAnalyticsSubject(userId);
          origin = generation;
        }
        await synchronizeAnalytics(
          userId,
          {},
          nextContext,
          () => !context && origin === generation,
        );
        if (needsInitialCapture && context && subject === userId && origin === generation)
          track("exception_captured", diagnostic);
      })
      .catch(() => {});
  }
}
