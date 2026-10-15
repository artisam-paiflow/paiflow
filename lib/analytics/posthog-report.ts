import "server-only";
import { z } from "zod";
import { posthogReportConfig } from "@/lib/env";
import { UsageReportSchema, type UsageReportInput } from "./report-schema";
import { TRACKING_VERSION } from "./policy";
import {
  POSTHOG_EVENTS,
  POSTHOG_METRICS,
  PosthogScopeSchema,
  PosthogSummarySchema,
  PosthogReportError,
} from "./posthog-report-schema";

const ResponseSchema = z.object({
  results: z
    .array(z.tuple([z.enum(POSTHOG_METRICS), z.string().regex(/^\d+$/)]))
    .max(POSTHOG_METRICS.length),
  hasMore: z.boolean().nullish(),
  query_status: z.object({ complete: z.boolean(), error: z.boolean().optional() }).nullish(),
});

/** Only validated enums, canonical timestamps and a restricted hostname enter this fixed SQL. */
export function posthogSummaryQuery(
  input: UsageReportInput,
  scope: z.infer<typeof PosthogScopeSchema>,
) {
  const options = UsageReportSchema.parse(input);
  const { app_env, app_host } = PosthogScopeSchema.parse(scope);
  const date = (value: string) => new Date(value).toISOString().replace("T", " ").replace("Z", "");
  const events = POSTHOG_EVENTS.map((event) => `'${event}'`).join(", ");
  const where = `timestamp >= toDateTime64('${date(options.start)}', 3, 'UTC')
    AND timestamp < toDateTime64('${date(options.end)}', 3, 'UTC')
    AND properties.app_env = '${app_env}' AND properties.app_host = '${app_host}'
    AND properties.stellar_network = '${options.network}' AND properties.audience = '${options.audience}'
    AND properties.tracking_version = '${TRACKING_VERSION}' AND event IN (${events})`;
  return `SELECT 'active_accounts', toString(uniqExactIf(toString(properties.account_id),
      match(toString(properties.account_id), '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')))
    FROM events WHERE ${where}
    UNION ALL
    SELECT event, toString(count()) FROM events WHERE ${where} GROUP BY event
    LIMIT ${POSTHOG_METRICS.length}`;
}

/** Aggregate-only query; credentials and raw PostHog response bodies never enter reports/errors. */
export async function posthogSummary(
  input: UsageReportInput,
  scope: z.infer<typeof PosthogScopeSchema>,
) {
  const options = PosthogScopeSchema.parse(scope);
  const config = posthogReportConfig();
  const query = posthogSummaryQuery(input, options);
  let response: Response;
  try {
    response = await fetch(`${config.apiHost}/api/projects/${config.projectId}/query/`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(45_000),
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Paiflow analytics snapshot aggregates v1",
        refresh: "force_blocking",
        query: { kind: "HogQLQuery", query },
      }),
    });
  } catch {
    throw new PosthogReportError("PostHog query could not complete; check connectivity and retry");
  }
  if (!response.ok)
    throw new PosthogReportError(
      `PostHog query failed (HTTP ${response.status}); check query:read access and project settings`,
    );
  let body: z.infer<typeof ResponseSchema>;
  try {
    body = ResponseSchema.parse(await response.json());
  } catch {
    throw new PosthogReportError(
      "PostHog returned an invalid aggregate response; no snapshot saved",
    );
  }
  if (body.hasMore || body.query_status?.complete === false || body.query_status?.error)
    throw new PosthogReportError("PostHog query was incomplete; no snapshot saved");
  const totals: Record<string, string> = Object.fromEntries(
    POSTHOG_METRICS.map((metric) => [metric, "0"]),
  );
  const seen = new Set<string>();
  for (const [metric, value] of body.results) {
    if (seen.has(metric))
      throw new PosthogReportError("PostHog returned duplicate metrics; no snapshot saved");
    seen.add(metric);
    totals[metric] = value;
  }
  // This aggregate always returns a row, even if no event rows match. Missing is not zero.
  if (!seen.has("active_accounts"))
    throw new PosthogReportError("PostHog summary missing; no snapshot saved");
  return PosthogSummarySchema.parse({
    query_version: 1,
    api_host: config.apiHost,
    project_id: config.projectId,
    ...options,
    generated_at: new Date().toISOString(),
    totals,
  });
}
