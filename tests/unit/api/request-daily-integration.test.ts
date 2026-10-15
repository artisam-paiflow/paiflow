import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/db", () => ({
  get db() {
    return h.db!;
  },
}));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
import { apiDailyReport } from "@/lib/api/request-history/daily-report";
import { drainApiRequests } from "@/lib/api/request-history/delivery";
import type { ApiRequestRecord } from "@/lib/api/request-history/schema";

// Opt-in destructive fixture reset: restricted to a dedicated local container/database.
const url = process.env.API_DAILY_TEST_DATABASE_URL;
const migration = "20261015130000_api_request_daily_aggregates";
const marker = "daily-aggregate-test";
const day = (value: Date) => value.toISOString().slice(0, 10);
const fixture = (patch: Partial<ApiRequestRecord> = {}): ApiRequestRecord => ({
  id: randomUUID(),
  requestId: randomUUID(),
  occurredAt: new Date().toISOString(),
  accountId: null,
  tokenCreatorId: null,
  apiTokenId: null,
  deploymentId: null,
  txHash: null,
  preparationRequestId: null,
  callerType: "unknown",
  method: "GET",
  endpoint: "/api/v1/deployments/:id/events",
  status: 200,
  durationMs: 20,
  errorCode: null,
  network: "testnet",
  environment: marker,
  appVersion: marker,
  audience: "UNCLASSIFIED",
  trackingVersion: "api-requests-v1",
  ...patch,
});
const ancient = fixture({
  occurredAt: new Date(Date.now() - 35 * 86400000).toISOString(),
  status: 401,
  durationMs: 10,
});
const retained = fixture({ status: 429, durationMs: 30 });
async function insert(record: ApiRequestRecord) {
  return h.db!.apiRequestLog.createMany({
    data: [{ ...record, occurredAt: new Date(record.occurredAt) }],
    skipDuplicates: true,
  });
}
async function count(environment: string) {
  const [row] = await h.db!.$queryRaw<{ requests: string; errors: string; duration: string }[]>`
    SELECT COALESCE(sum(requests),0)::text AS requests, COALESCE(sum(errors),0)::text AS errors,
      COALESCE(sum("totalDurationMs"),0)::text AS duration FROM "ApiRequestDailyAggregate" WHERE environment=${environment}`;
  return row!;
}

describe.skipIf(!url)("daily API aggregates on PostgreSQL", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      parsed.hostname !== "127.0.0.1" ||
      parsed.port !== "55489" ||
      parsed.pathname !== "/api_daily_test"
    )
      throw new Error("Dedicated local api_daily_test on 127.0.0.1:55489 required");
    h.db = new PrismaClient({ datasourceUrl: url });
    await h.db.$executeRaw`DROP SCHEMA public CASCADE`;
    await h.db.$executeRaw`CREATE SCHEMA public`;
    const root = join(process.cwd(), "prisma/migrations");
    const prior = readdirSync(root)
      .filter((name) => name < migration && /^\d/.test(name))
      .sort();
    execFileSync("psql", [url!, "-X", "-v", "ON_ERROR_STOP=1"], {
      input: prior
        .map((name) => readFileSync(join(root, name, "migration.sql"), "utf8"))
        .join("\n"),
      stdio: ["pipe", "pipe", "pipe"],
    });
    await h.db.analyticsPolicy.update({
      where: { version: "api-requests-v1" },
      data: { activatedAt: new Date(Date.now() - 90 * 86400000) },
    });
    await insert(ancient);
    await insert(retained);
    execFileSync(
      "psql",
      [url!, "-X", "-v", "ON_ERROR_STOP=1", "-f", join(root, migration, "migration.sql")],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
  }, 60000);
  afterAll(async () => {
    await h.db?.$disconnect();
  });

  it("backfills retained raw history and records the conservative coverage boundary", async () => {
    expect(await count(marker)).toEqual({ requests: "2", errors: "2", duration: "40" });
    const [coverage] = await h.db!.$queryRaw<
      { coverageFrom: Date }[]
    >`SELECT "coverageFrom" FROM "ApiRequestDailyCoverage"`;
    expect(Math.abs(coverage!.coverageFrom.getTime() - (Date.now() - 30 * 86400000))).toBeLessThan(
      60000,
    );
  });

  it("retains totals and deduplication after actual 30-day cleanup and replay", async () => {
    const before = await count(marker);
    const result = await drainApiRequests();
    expect(result.removed).toBeGreaterThanOrEqual(1);
    expect(await h.db!.apiRequestLog.findUnique({ where: { id: ancient.id } })).toBeNull();
    await insert(ancient);
    await insert(retained);
    expect(await count(marker)).toEqual(before);
  });

  it("counts fresh HTTP retries but not telemetry replays, including concurrent batches", async () => {
    const environment = "daily-concurrency",
      same = fixture({ environment });
    await Promise.all([insert(same), insert(same)]);
    await Promise.all([
      insert(fixture({ environment, durationMs: 100 })),
      insert(fixture({ environment, durationMs: 200, status: 500 })),
    ]);
    expect(await count(environment)).toEqual({ requests: "3", errors: "1", duration: "320" });
  });

  it("aggregates a full drainer-sized batch once without losing counters", async () => {
    const environment = "daily-batch";
    const rows = Array.from({ length: 200 }, (_, i) =>
      fixture({ environment, durationMs: i, status: i % 2 ? 429 : 200 }),
    );
    const data = rows.map((row) => ({ ...row, occurredAt: new Date(row.occurredAt) }));
    await h.db!.apiRequestLog.createMany({ data, skipDuplicates: true });
    await h.db!.apiRequestLog.createMany({ data, skipDuplicates: true });
    expect(await count(environment)).toEqual({ requests: "200", errors: "100", duration: "19900" });
    const [aggregate] = await h.db!.$queryRaw<
      { rate: string; min: number; max: number }[]
    >`SELECT "rateLimited"::text AS rate, "minDurationMs" AS min, "maxDurationMs" AS max FROM "ApiRequestDailyAggregate" WHERE environment=${environment}`;
    expect(aggregate).toEqual({ rate: "100", min: 0, max: 199 });
  });

  it("rolls back raw rows, receipts and totals together on transaction failure", async () => {
    const record = fixture({ environment: "daily-rollback" });
    await expect(
      h.db!.$transaction(async (tx) => {
        await tx.apiRequestLog.create({
          data: { ...record, occurredAt: new Date(record.occurredAt) },
        });
        throw new Error("synthetic rollback");
      }),
    ).rejects.toThrow("synthetic rollback");
    expect(await count(record.environment)).toMatchObject({ requests: "0" });
    const [receipts] = await h.db!.$queryRaw<
      { count: string }[]
    >`SELECT count(*)::text AS count FROM "ApiRequestAggregateReceipt" WHERE id=${record.id}::uuid`;
    expect(receipts!.count).toBe("0");
    expect(await h.db!.apiRequestLog.findUnique({ where: { id: record.id } })).toBeNull();
  });

  it("cannot commit a request if its aggregate update fails", async () => {
    await h.db!
      .$executeRaw`ALTER TABLE "ApiRequestDailyAggregate" ADD CONSTRAINT synthetic_daily_failure CHECK (environment <> 'daily-force-failure') NOT VALID`;
    const record = fixture({ environment: "daily-force-failure" });
    try {
      await expect(insert(record)).rejects.toThrow();
      expect(await h.db!.apiRequestLog.findUnique({ where: { id: record.id } })).toBeNull();
      const [receipts] = await h.db!.$queryRaw<
        { count: string }[]
      >`SELECT count(*)::text AS count FROM "ApiRequestAggregateReceipt" WHERE id=${record.id}::uuid`;
      expect(receipts!.count).toBe("0");
    } finally {
      await h.db!
        .$executeRaw`ALTER TABLE "ApiRequestDailyAggregate" DROP CONSTRAINT synthetic_daily_failure`;
    }
  });

  it("buckets late arrivals by UTC request date independently of session timezone", async () => {
    const environment = "daily-utc",
      date = day(new Date(Date.now() - 86400000));
    const record = fixture({ environment, occurredAt: date + "T23:59:59.999Z" });
    await h.db!.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Asia/Manila'`;
      await tx.apiRequestLog.create({
        data: { ...record, occurredAt: new Date(record.occurredAt) },
      });
    });
    const rows = await h.db!.$queryRaw<
      { day: Date; requests: string }[]
    >`SELECT day,requests::text AS requests FROM "ApiRequestDailyAggregate" WHERE environment=${environment}`;
    expect(rows.map((row) => [day(row.day), row.requests])).toEqual([[date, "1"]]);
  });

  it("reports correctly weighted latency and preserves scope across historical windows", async () => {
    const yesterday = day(new Date(Date.now() - 86400000)),
      today = day(new Date()),
      tomorrow = day(new Date(Date.now() + 86400000));
    const environment = "daily-report";
    await insert(
      fixture({ environment, occurredAt: yesterday + "T12:00:00Z", durationMs: 10, status: 401 }),
    );
    await insert(fixture({ environment, occurredAt: today + "T00:00:00Z", durationMs: 100 }));
    await insert(fixture({ environment, occurredAt: today + "T00:00:00Z", durationMs: 200 }));
    await insert(
      fixture({
        environment,
        occurredAt: today + "T00:00:00Z",
        audience: "INTERNAL",
        durationMs: 900,
      }),
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 60 * 86400000);
    try {
      const report = await apiDailyReport({
        start: yesterday,
        end: tomorrow,
        network: "testnet",
        environment,
        audience: "UNCLASSIFIED",
      });
      expect(report.totals).toMatchObject({
        requests: "3",
        errors: "1",
        authentication_failures: "1",
        rate_limited: "0",
        total_duration_ms: "310",
        mean_duration_ms: 310 / 3,
        min_duration_ms: 10,
        max_duration_ms: 200,
      });
      expect(report.daily).toHaveLength(2);
      expect(report.endpoints).toHaveLength(1);
      expect(JSON.stringify(report)).not.toContain("account_id");
    } finally {
      vi.useRealTimers();
    }
    const bounded = await apiDailyReport({
      start: yesterday,
      end: today,
      network: "testnet",
      environment,
      audience: "UNCLASSIFIED",
    });
    expect(bounded.totals.requests).toBe("1");
  });

  it("refuses inaccessible history rather than returning a misleading zero", async () => {
    await expect(
      apiDailyReport({
        start: "2000-01-01",
        end: "2000-01-02",
        network: "testnet",
        environment: marker,
        audience: "UNCLASSIFIED",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("returns empty totals without claiming latency or widening a supplied scope", async () => {
    const today = day(new Date()),
      tomorrow = day(new Date(Date.now() + 86400000));
    const report = await apiDailyReport({
      start: today,
      end: tomorrow,
      network: "testnet",
      environment: "x' OR true --",
      audience: "UNCLASSIFIED",
    });
    expect(report.totals).toMatchObject({
      requests: "0",
      mean_duration_ms: null,
      min_duration_ms: null,
      max_duration_ms: null,
    });
    expect(report.endpoints).toEqual([]);
    expect(report.daily).toEqual([]);
    expect(report.current_or_future_days_included).toBe(true);
  });
});
