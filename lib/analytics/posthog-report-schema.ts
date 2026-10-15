import { z } from "zod";

/** Messages contain only fixed diagnostics, never response bodies or credentials. */
export class PosthogReportError extends Error {}

export const POSTHOG_EVENTS = [
  "$pageview",
  "login_succeeded",
  "flow_created",
  "builder_opened",
  "node_added",
  "validation_error_appeared",
  "validation_error_resolved",
  "flow_autosave_failed",
  "deploy_review_viewed",
  "deploy_started",
  "deploy_confirmed",
  "deploy_failed",
  "trigger_page_viewed",
  "trigger_started",
  "trigger_confirmed",
  "trigger_failed",
  "trigger_failed_onchain",
  "error_shown",
  "exception_captured",
  "live_feed_disconnected",
] as const;
export const POSTHOG_METRICS = ["active_accounts", ...POSTHOG_EVENTS] as const;
export const PosthogScopeSchema = z.object({
  app_env: z.enum(["local", "staging", "beta"]),
  app_host: z
    .string()
    .max(253)
    .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/),
});
export const PosthogApiHostSchema = z.enum(["https://us.posthog.com", "https://eu.posthog.com"]);
export const PosthogTotalsSchema = z
  .record(z.enum(POSTHOG_METRICS), z.string().regex(/^\d+$/))
  .refine((value) => POSTHOG_METRICS.every((metric) => metric in value), "Missing PostHog metric");
export const PosthogSummarySchema = PosthogScopeSchema.extend({
  query_version: z.literal(1),
  api_host: PosthogApiHostSchema,
  project_id: z.string().regex(/^[1-9][0-9]*$/),
  generated_at: z.string().datetime(),
  totals: PosthogTotalsSchema,
});
export type PosthogSummary = z.infer<typeof PosthogSummarySchema>;
