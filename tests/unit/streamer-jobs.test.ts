import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { StreamerClaimJobStatus } from "@prisma/client";
import {
  computeNextMilestone,
  scheduleNextStreamerClaimJob,
  getDueStreamerJobs,
  rescheduleStreamerJob,
  cancelPendingStreamerJobs,
} from "@/lib/streamer-jobs";

describe("computeNextMilestone", () => {
  it("returns startTs when fromDate is before the stream starts", () => {
    const startTs = 1_000_000;
    const endTs = 2_000_000;
    const intervalSeconds = 60;
    const fromDate = new Date((startTs - 1) * 1000);

    const result = computeNextMilestone(startTs, endTs, intervalSeconds, fromDate);
    expect(result).toEqual(new Date(startTs * 1000));
  });

  it("returns the next interval boundary during the stream", () => {
    const startTs = 1_000_000;
    const intervalSeconds = 60;
    const fromDate = new Date((startTs + 75) * 1000); // 1 interval + 15s

    const result = computeNextMilestone(startTs, 2_000_000, intervalSeconds, fromDate);
    expect(result).toEqual(new Date((startTs + 2 * intervalSeconds) * 1000));
  });

  it("returns null when the stream has ended", () => {
    const startTs = 1_000_000;
    const endTs = 2_000_000;
    const fromDate = new Date(endTs * 1000);

    const result = computeNextMilestone(startTs, endTs, 60, fromDate);
    expect(result).toBeNull();
  });

  it("returns null when the next boundary is at or past endTs", () => {
    const startTs = 1_000_000;
    const endTs = startTs + 90;
    const fromDate = new Date((startTs + 60) * 1000);

    const result = computeNextMilestone(startTs, endTs, 90, fromDate);
    expect(result).toBeNull();
  });

  it("returns null for invalid intervals", () => {
    expect(computeNextMilestone(1_000_000, 2_000_000, 0)).toBeNull();
    expect(computeNextMilestone(1_000_000, 2_000_000, -1)).toBeNull();
    expect(computeNextMilestone(2_000_000, 1_000_000, 60)).toBeNull();
  });
});

describe("scheduleNextStreamerClaimJob", () => {
  beforeEach(async () => {
    await db.streamerClaimJob.deleteMany();
    await db.deployment.deleteMany();
  });

  afterEach(async () => {
    await db.streamerClaimJob.deleteMany();
    await db.deployment.deleteMany();
  });

  async function makeDeployment() {
    const user = await db.user.create({
      data: {
        username: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        passwordHash: "hash",
      },
    });
    const flow = await db.flow.create({
      data: {
        ownerId: user.id,
        name: "test",
        templateKind: "STREAMER",
        graph: {},
        parameters: {},
      },
    });
    return db.deployment.create({
      data: {
        flowId: flow.id,
        ownerId: user.id,
        network: "testnet",
        status: "CONFIRMED",
        graphSnapshot: {},
        paramsSnapshot: {},
      },
    });
  }

  it("creates a pending job at the next milestone", async () => {
    const deployment = await makeDeployment();
    const startTs = Math.floor(Date.now() / 1000) + 60;
    const params = {
      startTs,
      endTs: startTs + 3600,
      intervalSeconds: 60,
    };

    const result = await scheduleNextStreamerClaimJob(db, deployment.id, "node-1", "C123", params);

    expect(result).not.toBeNull();
    expect(result!.runAt).toEqual(new Date(startTs * 1000));

    const job = await db.streamerClaimJob.findUnique({ where: { id: result!.id } });
    expect(job).toMatchObject({
      deploymentId: deployment.id,
      nodeId: "node-1",
      contractAddress: "C123",
      status: StreamerClaimJobStatus.PENDING,
    });
  });

  it("does not create a duplicate active job", async () => {
    const deployment = await makeDeployment();
    const params = {
      startTs: Math.floor(Date.now() / 1000) + 60,
      endTs: Math.floor(Date.now() / 1000) + 3600,
      intervalSeconds: 60,
    };

    const first = await scheduleNextStreamerClaimJob(db, deployment.id, "node-1", "C123", params);
    const second = await scheduleNextStreamerClaimJob(db, deployment.id, "node-1", "C123", params);

    expect(second!.id).toBe(first!.id);

    const count = await db.streamerClaimJob.count({
      where: { deploymentId: deployment.id },
    });
    expect(count).toBe(1);
  });

  it("creates a new job after the previous one is terminal", async () => {
    const deployment = await makeDeployment();
    const nowSec = Math.floor(Date.now() / 1000);
    const params = {
      startTs: nowSec + 60,
      endTs: nowSec + 3600,
      intervalSeconds: 60,
    };

    const first = await scheduleNextStreamerClaimJob(db, deployment.id, "node-1", "C123", params);
    await rescheduleStreamerJob(db, first!.id, { status: StreamerClaimJobStatus.CLAIMED });

    const second = await scheduleNextStreamerClaimJob(db, deployment.id, "node-1", "C123", params);
    expect(second!.id).not.toBe(first!.id);
  });

  it("returns null when the stream has ended", async () => {
    const deployment = await makeDeployment();
    const nowSec = Math.floor(Date.now() / 1000);
    const params = {
      startTs: nowSec - 7200,
      endTs: nowSec - 3600,
      intervalSeconds: 60,
    };

    const result = await scheduleNextStreamerClaimJob(db, deployment.id, "node-1", "C123", params);
    expect(result).toBeNull();
  });
});

describe("getDueStreamerJobs", () => {
  beforeEach(async () => {
    await db.streamerClaimJob.deleteMany();
    await db.deployment.deleteMany();
  });

  afterEach(async () => {
    await db.streamerClaimJob.deleteMany();
    await db.deployment.deleteMany();
  });

  async function makeDeployment() {
    const user = await db.user.create({
      data: {
        username: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        passwordHash: "hash",
      },
    });
    const flow = await db.flow.create({
      data: {
        ownerId: user.id,
        name: "test",
        templateKind: "STREAMER",
        graph: {},
        parameters: {},
      },
    });
    return db.deployment.create({
      data: {
        flowId: flow.id,
        ownerId: user.id,
        network: "testnet",
        status: "CONFIRMED",
        graphSnapshot: {},
        paramsSnapshot: {},
      },
    });
  }

  it("returns only pending jobs that are due", async () => {
    const deployment = await makeDeployment();
    const now = new Date();

    const due = await db.streamerClaimJob.create({
      data: {
        deploymentId: deployment.id,
        nodeId: "due",
        contractAddress: "C1",
        runAt: new Date(now.getTime() - 60_000),
        status: StreamerClaimJobStatus.PENDING,
      },
    });

    await db.streamerClaimJob.create({
      data: {
        deploymentId: deployment.id,
        nodeId: "future",
        contractAddress: "C2",
        runAt: new Date(now.getTime() + 60_000),
        status: StreamerClaimJobStatus.PENDING,
      },
    });

    await db.streamerClaimJob.create({
      data: {
        deploymentId: deployment.id,
        nodeId: "running",
        contractAddress: "C3",
        runAt: new Date(now.getTime() - 60_000),
        status: StreamerClaimJobStatus.RUNNING,
      },
    });

    const jobs = await getDueStreamerJobs(db, 10);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.id).toBe(due.id);
  });
});

describe("cancelPendingStreamerJobs", () => {
  beforeEach(async () => {
    await db.streamerClaimJob.deleteMany();
    await db.deployment.deleteMany();
  });

  afterEach(async () => {
    await db.streamerClaimJob.deleteMany();
    await db.deployment.deleteMany();
  });

  async function makeDeployment() {
    const user = await db.user.create({
      data: {
        username: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        passwordHash: "hash",
      },
    });
    const flow = await db.flow.create({
      data: {
        ownerId: user.id,
        name: "test",
        templateKind: "STREAMER",
        graph: {},
        parameters: {},
      },
    });
    return db.deployment.create({
      data: {
        flowId: flow.id,
        ownerId: user.id,
        network: "testnet",
        status: "CONFIRMED",
        graphSnapshot: {},
        paramsSnapshot: {},
      },
    });
  }

  it("cancels pending and running jobs for a deployment", async () => {
    const deployment = await makeDeployment();
    const base = {
      deploymentId: deployment.id,
      contractAddress: "C1",
      runAt: new Date(),
    };

    const pending = await db.streamerClaimJob.create({
      data: { ...base, nodeId: "p1", status: StreamerClaimJobStatus.PENDING },
    });
    const running = await db.streamerClaimJob.create({
      data: { ...base, nodeId: "r1", status: StreamerClaimJobStatus.RUNNING },
    });
    const claimed = await db.streamerClaimJob.create({
      data: { ...base, nodeId: "c1", status: StreamerClaimJobStatus.CLAIMED },
    });

    const count = await cancelPendingStreamerJobs(db, deployment.id);
    expect(count).toBe(2);

    const jobs = await db.streamerClaimJob.findMany({
      where: { deploymentId: deployment.id },
    });

    const statuses = new Map(jobs.map((j) => [j.nodeId, j.status]));
    expect(statuses.get("p1")).toBe(StreamerClaimJobStatus.CANCELLED);
    expect(statuses.get("r1")).toBe(StreamerClaimJobStatus.CANCELLED);
    expect(statuses.get("c1")).toBe(StreamerClaimJobStatus.CLAIMED);
  });
});
