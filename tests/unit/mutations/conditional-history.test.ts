import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Deployment, Prisma, PrismaClient } from "@prisma/client";
import { conditionalDeploymentFixture } from "@/tests/fixtures/conditional-deployment";
import { scratchDatabase } from "@/tests/helpers/scratch-database";
const mocks = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, key) {
        const value = Reflect.get(mocks.client, key);
        return typeof value === "function" ? value.bind(mocks.client) : value;
      },
    },
  ),
}));
import { db } from "@/lib/db";
import {
  conditionalConfigurationHistory,
  recordConditionalConfigurationObservation as record,
  recordConditionalConfigurationObservations as recordAll,
} from "@/lib/mutations/conditional-history";
import { configurationHistory } from "@/lib/mutations/history";
import { projectConditionalConfigurationEvent } from "@/lib/stellar/conditional-configuration-events";
import { conditionalNodeStateScVal } from "@/lib/stellar/conditional-v2-codec";
import { scValToNative } from "@stellar/stellar-sdk";
const scratch = scratchDatabase();
let ownerId: string, flowId: string, deployment: Deployment;
let fixture: ReturnType<typeof conditionalDeploymentFixture>;
const json = (value: unknown): unknown =>
  typeof value === "bigint"
    ? String(value)
    : Array.isArray(value)
      ? value.map(json)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([key, value]) => [key, json(value)]))
        : value;
beforeAll(async () => {
  mocks.client = await scratch.start();
  ownerId = (
    await db.user.create({
      data: { username: `conditional-history-${randomUUID()}`, passwordHash: "unused" },
    })
  ).id;
  flowId = (
    await db.flow.create({
      data: { ownerId, name: "history", templateKind: "PAYER", graph: {}, parameters: {} },
    })
  ).id;
});
afterAll(async () => {
  await scratch.stop();
});
beforeEach(async () => {
  fixture = conditionalDeploymentFixture(true);
  deployment = await db.deployment.create({
    data: {
      ownerId,
      flowId,
      network: "testnet",
      status: "CONFIRMED",
      sourceAccount: fixture.deployment.sourceAccount,
      graphSnapshot: fixture.deployment.graphSnapshot as Prisma.InputJsonValue,
      paramsSnapshot: fixture.paramsSnapshot as unknown as Prisma.InputJsonValue,
      pipelineSnapshot: fixture.pipelineSnapshot as unknown as Prisma.InputJsonValue,
    },
  });
});
const states = () => fixture.plan.manifest.nodes.map(({ state }) => structuredClone(state));
const condition = (revision = "3", threshold = "200") => {
  const state = states()[2]!;
  state.revision = revision;
  if (state.configuration.kind === "condition") state.configuration.thresholdStroops = threshold;
  return state;
};
describe("conditional observed history on isolated PostgreSQL", () => {
  it("records the complete graph including immutable nodes without inventing mutation events; ledger never changes content identity", async () => {
    await recordAll(deployment.id, states(), 10);
    await recordAll(deployment.id, states(), 100);
    const history = await conditionalConfigurationHistory(deployment.id, { limit: 100 });
    expect(history.items).toHaveLength(5);
    expect(history.revisionCoverage.map(({ nodeId }) => nodeId)).toEqual(
      states().map(({ nodeId }) => nodeId),
    );
    expect(
      history.items.every(
        (item) =>
          item.observedLedger === 10 &&
          item.eventId === null &&
          item.eventLedger === null &&
          item.txHash === null,
      ),
    ).toBe(true);
    expect(history.historyComplete).toBe(false);
    expect(JSON.stringify(history)).not.toContain("private@example.invalid");
    expect(await db.configurationHistory.count({ where: { deploymentId: deployment.id } })).toBe(5);
  });
  it("keeps unknown revision gaps honest, supports out of order observations and enriches nullable provenance exactly once", async () => {
    await record(deployment.id, condition(), 30);
    const before = await db.configurationHistory.findFirstOrThrow({
      where: { deploymentId: deployment.id },
    });
    await record(deployment.id, condition(), 20, {
      eventId: `event-${randomUUID()}`,
      txHash: "aa".repeat(32),
    });
    const enriched = await db.configurationHistory.findUniqueOrThrow({ where: { id: before.id } });
    expect(enriched.observedLedger).toBe(30);
    expect(enriched.eventLedger).toBe(20);
    expect(enriched.contentHash).toBe(before.contentHash);
    expect(enriched.configuration).toEqual(before.configuration);
    await record(deployment.id, condition(), 20, {
      eventId: enriched.eventId!,
      txHash: enriched.txHash!,
    });
    let history = await conditionalConfigurationHistory(deployment.id, { limit: 100 });
    expect(history.revisionCoverage).toEqual([
      {
        nodeId: condition().nodeId,
        highestObservedRevision: "3",
        observedRevisionCount: "1",
        missingRevisionCount: "3",
      },
    ]);
    await record(deployment.id, condition("1", "100"), 15);
    await record(deployment.id, states()[2]!, 10);
    history = await conditionalConfigurationHistory(deployment.id, { limit: 1 });
    expect(history.revisionCoverage[0]).toMatchObject({
      observedRevisionCount: "3",
      missingRevisionCount: "1",
    });
    expect(history.nextCursor).not.toBeNull();
    const next = await conditionalConfigurationHistory(deployment.id, {
      limit: 100,
      cursor: history.nextCursor!,
    });
    expect(next.items).toHaveLength(2);
    expect(next.items.every((item) => item.id !== history.items[0]!.id)).toBe(true);
  });
  it("rejects conflicting content or provenance and database triggers retain original financial evidence", async () => {
    const receipt = { eventId: `event-${randomUUID()}`, txHash: "ab".repeat(32) };
    await record(deployment.id, condition(), 20, receipt);
    const row = await db.configurationHistory.findFirstOrThrow({
      where: { deploymentId: deployment.id },
    });
    await expect(record(deployment.id, condition("3", "201"), 21)).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
    });
    await expect(
      record(deployment.id, condition(), 20, { ...receipt, eventId: `other-${randomUUID()}` }),
    ).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    await expect(record(deployment.id, condition(), 21, receipt)).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
    });
    await expect(
      db.configurationHistory.update({
        where: { id: row.id },
        data: { contentHash: "f".repeat(64) },
      }),
    ).rejects.toBeDefined();
    expect(await db.configurationHistory.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
  });
  it("concurrent provenance enrichment never silently accepts a different receipt", async () => {
    await record(deployment.id, condition(), 30);
    const results = await Promise.allSettled(
      ["a", "b"].map((letter) =>
        record(deployment.id, condition(), 20, {
          eventId: `${letter}-${randomUUID()}`,
          txHash: letter.repeat(64),
        }),
      ),
    );
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(await db.configurationHistory.count({ where: { deploymentId: deployment.id } })).toBe(1);
  });
  it("rejects receipt claims for immutable revision zero and validates the whole getter batch before any write", async () => {
    await expect(
      record(deployment.id, states()[0]!, 10, {
        eventId: "fake-initial-event",
        txHash: "a".repeat(64),
      }),
    ).rejects.toBeDefined();
    const invalid = states();
    invalid[4]!.admin = invalid[0]!.contractAddress;
    await expect(recordAll(deployment.id, invalid, 10)).rejects.toBeDefined();
    await expect(recordAll(deployment.id, states().reverse(), 10)).rejects.toBeDefined();
    expect(await db.configurationHistory.count({ where: { deploymentId: deployment.id } })).toBe(0);
  });
  it("fences foreign cursors and explicit conditional generation before the legacy parser", async () => {
    await recordAll(deployment.id, states(), 10);
    await expect(
      conditionalConfigurationHistory(deployment.id, { limit: 10, cursor: randomUUID() }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(configurationHistory(deployment.id, { limit: 10 })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const legacy = await db.deployment.create({
      data: {
        ownerId,
        flowId,
        network: "testnet",
        status: "CONFIRMED",
        paramsSnapshot: [],
        graphSnapshot: {},
      },
    });
    await expect(conditionalConfigurationHistory(legacy.id, { limit: 10 })).rejects.toBeDefined();
  });
  it("retains raw evidence on projection failure and can replay successful full-state enrichment idempotently", async () => {
    const state = condition("1");
    const eventId = `event-${randomUUID()}`;
    const payload = {
      topics: ["config_v2", state.nodeId],
      contractAddress: state.contractAddress,
      value: json(scValToNative(conditionalNodeStateScVal(state))),
    } as Prisma.InputJsonValue;
    const event = await db.contractEvent.create({
      data: {
        deploymentId: deployment.id,
        eventId,
        kind: "STATUS_CHANGE",
        ledger: 25,
        txHash: "ef".repeat(32),
        payload,
        decodedData: {},
        occurredAt: new Date(),
      },
    });
    await record(deployment.id, condition("1", "201"), 30);
    await expect(projectConditionalConfigurationEvent(event)).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
    });
    expect((await db.contractEvent.findUniqueOrThrow({ where: { eventId } })).payload).toEqual(
      payload,
    );
    // A distinct original revision remains projectable after a transient decode failure.
    const replayState = condition("2");
    const replayId = `event-${randomUUID()}`;
    const replayPayload = {
      ...(payload as Prisma.JsonObject),
      value: json(scValToNative(conditionalNodeStateScVal(replayState))),
    } as Prisma.InputJsonValue;
    const replay = await db.contractEvent.create({
      data: {
        deploymentId: deployment.id,
        eventId: replayId,
        kind: "STATUS_CHANGE",
        ledger: 26,
        txHash: "fe".repeat(32),
        payload: replayPayload,
        decodedData: {},
        occurredAt: new Date(),
      },
    });
    expect(await projectConditionalConfigurationEvent(replay)).toEqual(replayState);
    expect(await projectConditionalConfigurationEvent(replay)).toEqual(replayState);
    expect(
      (await db.contractEvent.findUniqueOrThrow({ where: { eventId: replayId } })).decodedData,
    ).toEqual({ configuration: replayState });
    expect(
      (await conditionalConfigurationHistory(deployment.id, { limit: 100 })).revisionCoverage[0],
    ).toMatchObject({
      highestObservedRevision: "2",
      observedRevisionCount: "2",
      missingRevisionCount: "1",
    });
  });
});
