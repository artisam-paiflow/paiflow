-- Atomic installation/backfill: block raw inserts only while the new totals and trigger are installed.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
LOCK TABLE public."ApiRequestLog" IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE public."ApiRequestDailyAggregate" (
  day DATE NOT NULL,
  network TEXT NOT NULL,
  environment TEXT NOT NULL,
  audience public."AnalyticsAudience" NOT NULL,
  "trackingVersion" TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  requests BIGINT NOT NULL DEFAULT 0,
  errors BIGINT NOT NULL DEFAULT 0,
  "authenticationFailures" BIGINT NOT NULL DEFAULT 0,
  "rateLimited" BIGINT NOT NULL DEFAULT 0,
  "totalDurationMs" BIGINT NOT NULL DEFAULT 0,
  "minDurationMs" INTEGER NOT NULL,
  "maxDurationMs" INTEGER NOT NULL,
  "lastOccurredAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY (day, network, environment, audience, "trackingVersion", endpoint, method)
);
CREATE INDEX "ApiRequestDailyAggregate_scope_day_idx"
  ON public."ApiRequestDailyAggregate" (network, environment, audience, "trackingVersion", day);
CREATE TABLE public."ApiRequestAggregateReceipt" (id UUID PRIMARY KEY);
CREATE TABLE public."ApiRequestDailyCoverage" (
  version TEXT PRIMARY KEY,
  "coverageFrom" TIMESTAMP(3) NOT NULL,
  "backfilledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A full transition table groups each inserted batch, rather than one upsert per request.
-- ON CONFLICT inserts expose only the rows that were actually inserted.
-- Receipts survive retention: replay of a deleted raw row must not increment the total again.
CREATE FUNCTION public.accumulate_api_request_daily() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $function$
BEGIN
WITH receipts AS (
  INSERT INTO public."ApiRequestAggregateReceipt" (id)
  SELECT id FROM new_requests ORDER BY id
  ON CONFLICT DO NOTHING RETURNING id
)
INSERT INTO public."ApiRequestDailyAggregate" (
  day, network, environment, audience, "trackingVersion", endpoint, method,
  requests, errors, "authenticationFailures", "rateLimited", "totalDurationMs",
  "minDurationMs", "maxDurationMs", "lastOccurredAt"
)
SELECT r."occurredAt"::date, r.network, r.environment, r.audience,
  r."trackingVersion", r.endpoint, r.method, count(*)::bigint,
  count(*) FILTER (WHERE r.status >= 400)::bigint,
  count(*) FILTER (WHERE r.status = 401)::bigint,
  count(*) FILTER (WHERE r.status = 429)::bigint,
  sum(r."durationMs")::bigint, min(r."durationMs"), max(r."durationMs"), max(r."occurredAt")
FROM new_requests r JOIN receipts USING (id)
GROUP BY r."occurredAt"::date, r.network, r.environment, r.audience,
  r."trackingVersion", r.endpoint, r.method
ORDER BY r."occurredAt"::date, r.network, r.environment, r.audience,
  r."trackingVersion", r.endpoint, r.method
ON CONFLICT (day, network, environment, audience, "trackingVersion", endpoint, method)
DO UPDATE SET
  requests = "ApiRequestDailyAggregate".requests + EXCLUDED.requests,
  errors = "ApiRequestDailyAggregate".errors + EXCLUDED.errors,
  "authenticationFailures" = "ApiRequestDailyAggregate"."authenticationFailures" + EXCLUDED."authenticationFailures",
  "rateLimited" = "ApiRequestDailyAggregate"."rateLimited" + EXCLUDED."rateLimited",
  "totalDurationMs" = "ApiRequestDailyAggregate"."totalDurationMs" + EXCLUDED."totalDurationMs",
  "minDurationMs" = LEAST("ApiRequestDailyAggregate"."minDurationMs", EXCLUDED."minDurationMs"),
  "maxDurationMs" = GREATEST("ApiRequestDailyAggregate"."maxDurationMs", EXCLUDED."maxDurationMs"),
  "lastOccurredAt" = GREATEST("ApiRequestDailyAggregate"."lastOccurredAt", EXCLUDED."lastOccurredAt");
  RETURN NULL;
END;
$function$;
CREATE TRIGGER api_request_daily_insert
  AFTER INSERT ON public."ApiRequestLog"
  REFERENCING NEW TABLE AS new_requests
  FOR EACH STATEMENT EXECUTE FUNCTION public.accumulate_api_request_daily();

-- Existing retained history is counted once. This cannot restore already deleted requests.
WITH receipts AS (
  INSERT INTO public."ApiRequestAggregateReceipt" (id)
  SELECT id FROM public."ApiRequestLog" ORDER BY id
  ON CONFLICT DO NOTHING RETURNING id
)
INSERT INTO public."ApiRequestDailyAggregate" (
  day, network, environment, audience, "trackingVersion", endpoint, method,
  requests, errors, "authenticationFailures", "rateLimited", "totalDurationMs",
  "minDurationMs", "maxDurationMs", "lastOccurredAt"
)
SELECT r."occurredAt"::date, r.network, r.environment, r.audience,
  r."trackingVersion", r.endpoint, r.method, count(*)::bigint,
  count(*) FILTER (WHERE r.status >= 400)::bigint,
  count(*) FILTER (WHERE r.status = 401)::bigint,
  count(*) FILTER (WHERE r.status = 429)::bigint,
  sum(r."durationMs")::bigint, min(r."durationMs"), max(r."durationMs"), max(r."occurredAt")
FROM public."ApiRequestLog" r JOIN receipts USING (id)
GROUP BY r."occurredAt"::date, r.network, r.environment, r.audience,
  r."trackingVersion", r.endpoint, r.method
ORDER BY r."occurredAt"::date, r.network, r.environment, r.audience,
  r."trackingVersion", r.endpoint, r.method
ON CONFLICT (day, network, environment, audience, "trackingVersion", endpoint, method)
DO UPDATE SET
  requests = "ApiRequestDailyAggregate".requests + EXCLUDED.requests,
  errors = "ApiRequestDailyAggregate".errors + EXCLUDED.errors,
  "authenticationFailures" = "ApiRequestDailyAggregate"."authenticationFailures" + EXCLUDED."authenticationFailures",
  "rateLimited" = "ApiRequestDailyAggregate"."rateLimited" + EXCLUDED."rateLimited",
  "totalDurationMs" = "ApiRequestDailyAggregate"."totalDurationMs" + EXCLUDED."totalDurationMs",
  "minDurationMs" = LEAST("ApiRequestDailyAggregate"."minDurationMs", EXCLUDED."minDurationMs"),
  "maxDurationMs" = GREATEST("ApiRequestDailyAggregate"."maxDurationMs", EXCLUDED."maxDurationMs"),
  "lastOccurredAt" = GREATEST("ApiRequestDailyAggregate"."lastOccurredAt", EXCLUDED."lastOccurredAt");

INSERT INTO public."ApiRequestDailyCoverage" (version, "coverageFrom")
SELECT 'api-requests-daily-v1', GREATEST("activatedAt", CURRENT_TIMESTAMP - INTERVAL '30 days')
FROM public."AnalyticsPolicy" WHERE version = 'api-requests-v1';
COMMIT;
