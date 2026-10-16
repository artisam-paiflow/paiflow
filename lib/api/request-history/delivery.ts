import "server-only";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { log } from "@/lib/log";
import { ApiRequestRecordSchema, type ApiRequestRecord } from "./schema";
export const REQUEST_QUEUE = "telemetry:api-requests:v1";
export const REQUEST_HEALTH = "telemetry:api-requests:health:v1";
export const QUEUE_LIMIT = 10000;
export const RETENTION_DAYS = 30;
// Atomic capacity check. Each independently generated ID distinguishes HTTP retries.
const ENQUEUE = `if redis.call('ZCARD',KEYS[1]) >= tonumber(ARGV[1]) then
redis.call('HINCRBY',KEYS[2],'overflow',1); return 0 end
redis.call('ZADD',KEYS[1],ARGV[2],ARGV[3]); redis.call('HINCRBY',KEYS[2],'queued',1); return 1`;
async function redisDeadline<T>(operation: Promise<T>, milliseconds = 500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("redis_ack_timeout")), milliseconds);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
export async function queueApiRequest(record: ApiRequestRecord): Promise<boolean> {
  const parsed = ApiRequestRecordSchema.safeParse(record);
  if (!parsed.success) {
    log.warn({ reason: "invalid_record" }, "API telemetry dropped");
    return false;
  }
  const client = redis();
  if (!client) {
    log.warn({ reason: "redis_unavailable" }, "API telemetry dropped");
    return false;
  }
  try {
    const accepted = await redisDeadline(
      client.eval(
        ENQUEUE,
        2,
        REQUEST_QUEUE,
        REQUEST_HEALTH,
        QUEUE_LIMIT,
        Date.now(),
        JSON.stringify(parsed.data),
      ),
      100,
    );
    if (accepted !== 1) log.warn({ reason: "queue_full" }, "API telemetry dropped");
    return accepted === 1;
  } catch {
    log.warn({ reason: "enqueue_failed" }, "API telemetry dropped");
    return false;
  }
}
/** Retries keep the same record ID. A crash after DB commit before removal is harmless. */
export async function drainApiRequests() {
  let persisted = 0;
  try {
    const client = redis();
    if (client) {
      const members = await redisDeadline(client.zrange(REQUEST_QUEUE, 0, 199));
      const invalid: string[] = [];
      const valid: { member: string; record: ApiRequestRecord }[] = [];
      for (const member of members) {
        try {
          valid.push({ member, record: ApiRequestRecordSchema.parse(JSON.parse(member)) });
        } catch {
          invalid.push(member);
        }
      }
      if (invalid.length) {
        await redisDeadline(client.zrem(REQUEST_QUEUE, ...invalid));
        await redisDeadline(client.hincrby(REQUEST_HEALTH, "invalid", invalid.length));
      }
      if (valid.length) {
        try {
          const result = await db.$transaction(
            async (tx) => {
              const result = await tx.apiRequestLog.createMany({
                data: valid.map(({ record }) => ({
                  ...record,
                  occurredAt: new Date(record.occurredAt),
                })),
                skipDuplicates: true,
              });
              await tx.analyticsDelivery.createMany({
                data: valid.map(({ record }) => ({
                  id: record.id,
                  distinctId: record.accountId ?? `request:${record.id}`,
                  event: "api_request_completed",
                  personProfile: false,
                  occurredAt: new Date(record.occurredAt),
                  properties: {
                    request_id: record.requestId,
                    preparation_request_id: record.preparationRequestId,
                    endpoint: record.endpoint,
                    method: record.method,
                    http_status: record.status,
                    duration_ms: record.durationMs,
                    error_code: record.errorCode,
                    api_token_id: record.apiTokenId,
                    developer_api_token_id: record.developerApiTokenId ?? null,
                    token_creator_id: record.tokenCreatorId,
                    deployment_id: record.deploymentId,
                    tx_hash: record.txHash,
                    account_id: record.accountId ?? "",
                    caller_type: record.callerType,
                    audience: record.audience,
                    stellar_network: record.network,
                    app_env: record.environment,
                    app_version: record.appVersion,
                    tracking_version: record.trackingVersion,
                  },
                })),
                skipDuplicates: true,
              });
              return result;
            },
            { timeout: 2000 },
          );
          persisted = result.count;
          await redisDeadline(client.zrem(REQUEST_QUEUE, ...valid.map((v) => v.member)));
          await redisDeadline(client.hincrby(REQUEST_HEALTH, "persisted", persisted));
        } catch {
          await redisDeadline(client.hincrby(REQUEST_HEALTH, "delivery_failures", 1));
          log.warn(
            { reason: "persist_failed", batch: valid.length },
            "API telemetry delivery incomplete",
          );
        }
      }
    }
  } catch {
    log.warn({ reason: "drain_failed" }, "API telemetry delivery incomplete");
  }
  // Retention runs even when queue reads, removal or health counters fail.
  // One indexed bounded delete each tick; never scan/delete an unbounded backlog.
  const removed = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`;
      return tx.$executeRaw`DELETE FROM "ApiRequestLog" WHERE id IN
    (SELECT id FROM "ApiRequestLog" WHERE "occurredAt" < ${new Date(Date.now() - RETENTION_DAYS * 86400000)} ORDER BY "occurredAt" LIMIT 1000)`;
    },
    { timeout: 3000 },
  );
  const analyticsRemoved = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`;
      return tx.$executeRaw`DELETE FROM "AnalyticsDelivery" WHERE id IN
      (SELECT id FROM "AnalyticsDelivery" WHERE event = 'api_request_completed'
       AND "occurredAt" < ${new Date(Date.now() - RETENTION_DAYS * 86400000)} ORDER BY "occurredAt" LIMIT 1000)`;
    },
    { timeout: 3000 },
  );
  return { persisted, removed, analyticsRemoved, ...(await apiRequestHealth()) };
}
export async function apiRequestHealth() {
  const analytics = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`;
      const [analyticsPending, oldestAnalytics] = await Promise.all([
        tx.analyticsDelivery.count({
          where: { event: "api_request_completed", deliveredAt: null },
        }),
        tx.analyticsDelivery.findFirst({
          where: { event: "api_request_completed", deliveredAt: null },
          orderBy: { occurredAt: "asc" },
          select: { occurredAt: true, attempts: true },
        }),
      ]);
      return { analyticsPending, oldestAnalytics };
    },
    { timeout: 3000 },
  );
  const unavailable = {
    queueAvailable: false,
    pending: null,
    oldestAgeMs: null,
    counters: {},
    ...analytics,
  };
  const client = redis();
  if (!client || client.status !== "ready") return unavailable;
  try {
    const [pending, oldest, counters] = await Promise.all([
      redisDeadline(client.zcard(REQUEST_QUEUE)),
      redisDeadline(client.zrange(REQUEST_QUEUE, 0, 0, "WITHSCORES")),
      redisDeadline(client.hgetall(REQUEST_HEALTH)),
    ]);
    return {
      queueAvailable: true,
      pending,
      oldestAgeMs: oldest[1] ? Math.max(0, Date.now() - Number(oldest[1])) : null,
      counters,
      ...analytics,
    };
  } catch {
    return unavailable;
  }
}
