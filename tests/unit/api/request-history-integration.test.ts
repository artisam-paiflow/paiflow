import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ db: null as PrismaClient | null, redis: null as Redis | null }));
vi.mock("@/lib/db", () => ({
  get db() {
    return h.db!;
  },
}));
vi.mock("@/lib/redis", () => ({ redis: () => h.redis }));
import {
  queueApiRequest,
  drainApiRequests,
  REQUEST_QUEUE,
  REQUEST_HEALTH,
} from "@/lib/api/request-history/delivery";
import { apiRequestReport } from "@/lib/api/request-history/report";
import { type ApiRequestRecord } from "@/lib/api/request-history/schema";
const url = process.env.API_HISTORY_TEST_DATABASE_URL;
const uid = randomUUID();
const record = (patch: Partial<ApiRequestRecord> = {}): ApiRequestRecord => ({
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
  status: 401,
  durationMs: 10,
  errorCode: "UNAUTHENTICATED",
  network: "testnet",
  environment: "staging",
  appVersion: uid,
  audience: "UNCLASSIFIED",
  trackingVersion: "api-requests-v1",
  ...patch,
});
const options = () => ({
  start: new Date(Date.now() - 60000).toISOString(),
  end: new Date(Date.now() + 1000).toISOString(),
  network: "testnet" as const,
  audience: "UNCLASSIFIED" as const,
  environment: "staging",
});
describe.skipIf(!url)("request history on disposable PostgreSQL and Redis", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      parsed.hostname !== "127.0.0.1" ||
      parsed.port !== "55487" ||
      parsed.pathname !== "/issue847_test"
    )
      throw new Error("Dedicated local issue847_test required");
    h.db = new PrismaClient({ datasourceUrl: url });
    h.redis = new Redis("redis://127.0.0.1:6387", { maxRetriesPerRequest: 0 });
    await h.redis.ping();
    await h.redis.del(REQUEST_QUEUE, REQUEST_HEALTH);
    await h.db.analyticsPolicy.update({
      where: { version: "api-requests-v1" },
      data: { activatedAt: new Date(Date.now() - 120000) },
    });
  });
  afterAll(async () => {
    await h.db?.apiRequestLog.deleteMany({ where: { appVersion: uid } });
    await h.db?.analyticsDelivery.deleteMany({ where: { event: "api_request_completed" } });
    await h.db?.$disconnect();
    h.redis?.disconnect();
  });
  it("persists once across replay, creates atomic outbox records and reports unknown callers", async () => {
    const a = record();
    await queueApiRequest(a);
    await drainApiRequests();
    await queueApiRequest(a);
    await drainApiRequests();
    expect(await h.db!.apiRequestLog.count({ where: { id: a.id } })).toBe(1);
    expect(await h.db!.analyticsDelivery.count({ where: { id: a.id } })).toBe(1);
    const report = await apiRequestReport(options());
    expect(report.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          authentication_failures: "1",
          account_id: null,
          api_token_id: null,
        }),
      ]),
    );
  });
  it("caps a full queue atomically and expires retained rows without changing business events", async () => {
    const values = Array.from({ length: 10000 }, (_, i) => [
      Date.now(),
      `synthetic-capacity-${i}`,
    ]).flat();
    await h.redis!.zadd(REQUEST_QUEUE, ...values);
    expect(await queueApiRequest(record())).toBe(false);
    expect(await h.redis!.zcard(REQUEST_QUEUE)).toBe(10000);
    await h.redis!.del(REQUEST_QUEUE);
    const old = record({ occurredAt: new Date(Date.now() - 31 * 86400000).toISOString() });
    await h.db!.apiRequestLog.create({ data: { ...old, occurredAt: new Date(old.occurredAt) } });
    const business = randomUUID();
    await h.db!.analyticsDelivery.create({
      data: {
        id: business,
        distinctId: "synthetic",
        event: "transaction_outcome",
        properties: {},
        occurredAt: new Date(old.occurredAt),
      },
    });
    await drainApiRequests();
    expect(await h.db!.apiRequestLog.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await h.db!.analyticsDelivery.findUnique({ where: { id: business } })).not.toBeNull();
    await h.db!.analyticsDelivery.delete({ where: { id: business } });
  });
  it("expires request rows and outbox during Redis read failure, preserving business events", async () => {
    const old = record({ occurredAt: new Date(Date.now() - 31 * 86400000).toISOString() });
    const business = randomUUID();
    await h.db!.apiRequestLog.create({ data: { ...old, occurredAt: new Date(old.occurredAt) } });
    await h.db!.analyticsDelivery.createMany({
      data: [
        {
          id: old.id,
          distinctId: "synthetic",
          event: "api_request_completed",
          properties: {},
          occurredAt: new Date(old.occurredAt),
        },
        {
          id: business,
          distinctId: "synthetic",
          event: "transaction_outcome",
          properties: {},
          occurredAt: new Date(old.occurredAt),
        },
      ],
    });
    const read = vi.spyOn(h.redis!, "zrange").mockRejectedValue(new Error("offline"));
    try {
      const result = await drainApiRequests();
      expect(result).toMatchObject({ removed: 1, analyticsRemoved: 1, queueAvailable: false });
      expect(await h.db!.apiRequestLog.findUnique({ where: { id: old.id } })).toBeNull();
      expect(await h.db!.analyticsDelivery.findUnique({ where: { id: old.id } })).toBeNull();
      expect(await h.db!.analyticsDelivery.findUnique({ where: { id: business } })).not.toBeNull();
    } finally {
      read.mockRestore();
      await h.db!.analyticsDelivery.delete({ where: { id: business } });
    }
  });
  it("reports attributed outcomes, explicit preparation links, same-hash recovery and scheduled jobs", async () => {
    const client = h.db!;
    const user = await client.user.create({
      data: {
        username: `issue847-${randomUUID()}`,
        passwordHash: "synthetic",
        analyticsAudience: "INTERNAL",
      },
    });
    const flow = await client.flow.create({
      data: {
        ownerId: user.id,
        name: "synthetic",
        templateKind: "SPLITTER",
        graph: {},
        parameters: {},
      },
    });
    const deployment = await client.deployment.create({
      data: {
        flowId: flow.id,
        ownerId: user.id,
        network: "testnet",
        graphSnapshot: {},
        paramsSnapshot: {},
      },
    });
    const token = await client.deploymentApiToken.create({
      data: {
        deploymentId: deployment.id,
        createdById: user.id,
        tokenHash: randomUUID(),
        tokenPrefix: "synthetic",
      },
    });
    const hash = randomUUID().replaceAll("-", "").repeat(2);
    const base = {
      accountId: user.id,
      tokenCreatorId: user.id,
      apiTokenId: token.id,
      deploymentId: deployment.id,
      callerType: "deployment_token" as const,
      audience: "INTERNAL" as const,
      method: "POST" as const,
    };
    const time = Date.now() - 20000;
    try {
      await client.signedTransaction.create({
        data: {
          txHash: hash,
          signerAddress: "synthetic-public-address",
          kind: "API_EXECUTE",
          network: "testnet",
          deploymentId: deployment.id,
          apiTokenId: token.id,
          callerAccountId: user.id,
          audience: "INTERNAL",
          outcome: "CONFIRMED",
          submittedAt: new Date(time + 1000),
          confirmedAt: new Date(time + 5000),
          submissionRevision: 2,
        },
      });
      const prepare = record({
        ...base,
        endpoint: "/api/v1/deployments/:id/execute",
        status: 200,
        errorCode: null,
        occurredAt: new Date(time).toISOString(),
      });
      const otherPrepare = record({
        ...base,
        endpoint: prepare.endpoint,
        status: 200,
        errorCode: null,
        occurredAt: new Date(time).toISOString(),
      });
      const failed = record({
        ...base,
        endpoint: prepare.endpoint + "/submit",
        status: 502,
        errorCode: "UPSTREAM_RPC",
        txHash: hash,
        occurredAt: new Date(time + 1000).toISOString(),
      });
      const retry = record({
        ...base,
        endpoint: failed.endpoint,
        status: 200,
        errorCode: null,
        txHash: hash,
        preparationRequestId: prepare.id,
        occurredAt: new Date(time + 2000).toISOString(),
      });
      const forged = record({
        ...base,
        apiTokenId: randomUUID(),
        endpoint: failed.endpoint,
        status: 200,
        errorCode: null,
        txHash: hash,
        preparationRequestId: otherPrepare.id,
        occurredAt: new Date(time + 3000).toISOString(),
      });
      for (const row of [prepare, otherPrepare, failed, retry, forged]) await queueApiRequest(row);
      await drainApiRequests();
      await client.streamerClaimJob.create({
        data: {
          deploymentId: deployment.id,
          nodeId: "synthetic",
          contractAddress: "synthetic",
          runAt: new Date(time),
          status: "CLAIMED",
          claimedAt: new Date(time + 3000),
          attemptCount: 1,
        },
      });
      await client.payrollRun.create({
        data: {
          deploymentId: deployment.id,
          runAt: new Date(time),
          totalStroops: "100",
          status: "CHARGED",
          chargedAt: new Date(time + 2000),
          attemptCount: 1,
        },
      });
      const report = await apiRequestReport({ ...options(), audience: "INTERNAL" });
      expect(report.preparation).toEqual([
        expect.objectContaining({ preparations: "2", explicitly_linked_submissions: "1" }),
      ]);
      expect(report.recovery).toEqual([
        expect.objectContaining({
          failed_submit_requests: "1",
          recovered_same_hash_within_24h: "1",
        }),
      ]);
      expect(report.outcomes).toEqual([
        expect.objectContaining({
          outcome: "CONFIRMED",
          transactions: "1",
          actual_resends: "1",
          mean_confirmation_ms: expect.anything(),
        }),
      ]);
      expect(String(report.outcomes[0]?.mean_confirmation_ms)).toBe("4000");
      expect(report.scheduled_jobs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "streamer", status: "CLAIMED", jobs: "1" }),
          expect.objectContaining({ kind: "payroll", status: "CHARGED", jobs: "1" }),
        ]),
      );
      await client.user.update({ where: { id: user.id }, data: { analyticsAudience: "EXTERNAL" } });
      const anonymousHash = randomUUID().replaceAll("-", "").repeat(2);
      await client.signedTransaction.create({
        data: {
          txHash: anonymousHash,
          signerAddress: "synthetic-anonymous-source",
          kind: "TRIGGER",
          network: "testnet",
          deploymentId: deployment.id,
          outcome: "CONFIRMED",
          confirmedAt: new Date(),
          audience: "UNCLASSIFIED",
        },
      });
      await queueApiRequest(
        record({
          ...base,
          method: "GET",
          endpoint: "/api/v1/deployments/:id/transactions/:txHash",
          status: 200,
          errorCode: null,
          txHash: anonymousHash,
          audience: "EXTERNAL",
        }),
      );
      // The owner still has access after reclassification; historical transaction
      // audience must remain INTERNAL even when polls/retries are now EXTERNAL.
      await queueApiRequest(
        record({
          ...base,
          method: "GET",
          endpoint: "/api/v1/deployments/:id/transactions/:txHash",
          status: 200,
          errorCode: null,
          txHash: hash,
          audience: "EXTERNAL",
        }),
      );
      await queueApiRequest(
        record({
          ...failed,
          id: randomUUID(),
          requestId: randomUUID(),
          audience: "EXTERNAL",
        }),
      );
      await queueApiRequest(
        record({
          ...retry,
          id: randomUUID(),
          requestId: randomUUID(),
          audience: "EXTERNAL",
        }),
      );
      await drainApiRequests();
      const externalReport = await apiRequestReport({ ...options(), audience: "EXTERNAL" });
      expect(externalReport.weeks).toEqual([
        expect.objectContaining({ calling_accounts: "1", confirmed_accounts: "0" }),
      ]);
      expect(externalReport.outcomes).toEqual([]);
      expect(externalReport.recovery).toEqual([
        expect.objectContaining({
          failed_submit_requests: "1",
          recovered_same_hash_within_24h: "0",
        }),
      ]);
      expect(externalReport.activation).toEqual([
        expect.objectContaining({ tokens_with_confirmed_transactions: "0" }),
      ]);
    } finally {
      await client.signedTransaction.deleteMany({ where: { deploymentId: deployment.id } });
      await client.deployment.delete({ where: { id: deployment.id } });
      await client.flow.delete({ where: { id: flow.id } });
      await client.user.delete({ where: { id: user.id } });
    }
  });
  it("measures local acknowledgement overhead and batch delivery throughput", async () => {
    const times: number[] = [];
    const baseline: number[] = [];
    for (let i = 0; i < 200; i++) {
      let t = performance.now();
      JSON.stringify(record());
      baseline.push(performance.now() - t);
      t = performance.now();
      expect(await queueApiRequest(record({ status: 200, errorCode: null }))).toBe(true);
      times.push(performance.now() - t);
    }
    const begin = performance.now();
    const result = await drainApiRequests();
    const batchMs = performance.now() - begin;
    expect(result.persisted).toBe(200);
    expect(await h.redis!.zcard(REQUEST_QUEUE)).toBe(0);
    const p95 = (a: number[]) => a.sort((x, y) => x - y)[Math.floor(a.length * 0.95)];
    await writeFile(
      "/tmp/issue847-performance.json",
      JSON.stringify(
        {
          samples: 200,
          baseline_serialization_p95_ms: p95(baseline),
          redis_enqueue_p95_ms: p95(times),
          batch_200_ms: batchMs,
          scope:
            "Local telemetry overhead only; not hosted API p95. Two inserts in one transaction for 200 requests; no per-response PostgreSQL writes.",
        },
        null,
        2,
      ),
    );
  });
});
