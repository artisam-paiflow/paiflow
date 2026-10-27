import { randomBytes, randomUUID } from "node:crypto";
import { Address, Keypair, StrKey, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EventKind, type Prisma, type TemplateKind } from "@prisma/client";
import { db } from "@/lib/db";
import { pollEventsForWithOutcome } from "@/lib/stellar/events";
import {
  projectSubscriptionCharge,
  refreshSubscriptionSchedule,
  subscriptionBillingEmitter,
} from "@/lib/subscription/billing-history";

const mocks = vi.hoisted(() => ({
  rpc: { getEvents: vi.fn(), getHealth: vi.fn(), sendTransaction: vi.fn() },
  publish: vi.fn(async () => 1),
  invalidate: vi.fn(),
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => mocks.rpc }));
vi.mock("@/lib/redis", () => ({
  redis: () => ({ publish: mocks.publish }),
  eventChannel: (id: string) => `events:${id}`,
}));
vi.mock("@/lib/stellar/dashboard-balance-cache", () => ({
  invalidateDashboardBalances: mocks.invalidate,
}));
vi.mock("@/lib/flow-notifications", () => ({
  sendEmailNotificationsForTransactions: vi.fn(async () => undefined),
}));

let ownerId: string;
let flowId: string;
const ids: string[] = [];
const subscriber = Keypair.random().publicKey();
const time = new Date("2026-10-20T02:15:19Z");
const older = new Date(time.getTime() - 60_000);
const newer = new Date(time.getTime() + 60_000);
beforeAll(async () => {
  ownerId = (
    await db.user.create({ data: { username: `billing-${randomUUID()}`, passwordHash: "unused" } })
  ).id;
  flowId = (
    await db.flow.create({
      data: {
        ownerId,
        name: "billing history",
        templateKind: "SUBSCRIPTION",
        graph: {},
        parameters: {},
      },
    })
  ).id;
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.getEvents.mockResolvedValue({ events: [], latestLedger: 500 });
  mocks.rpc.getHealth.mockResolvedValue({ latestLedger: 500, oldestLedger: 1 });
});
afterAll(async () => {
  await db.contractEvent.deleteMany({ where: { deploymentId: { in: ids } } });
  await db.serviceTransaction.deleteMany({ where: { work: { deploymentId: { in: ids } } } });
  await db.deploymentWork.deleteMany({ where: { deploymentId: { in: ids } } });
  await db.eventCursor.deleteMany({ where: { deploymentId: { in: ids } } });
  await db.deployment.deleteMany({ where: { id: { in: ids } } });
  await db.flow.delete({ where: { id: flowId } });
  await db.user.delete({ where: { id: ownerId } });
});

async function fixture(kind: TemplateKind = "SUBSCRIPTION") {
  const emitter = StrKey.encodeContract(randomBytes(32));
  const pipeline = [{ nodeId: "subscription", contractAddress: emitter, templateKind: kind }];
  const row = await db.deployment.create({
    data: {
      ownerId,
      flowId,
      network: "testnet",
      status: "CONFIRMED",
      contractAddress: emitter,
      pipelineSnapshot: pipeline,
      graphSnapshot: {},
      paramsSnapshot: {},
      chargeRelayerMode: "PLATFORM",
      nextChargeAt: older,
    },
  });
  ids.push(row.id);
  await db.eventCursor.create({ data: { deploymentId: row.id, lastLedger: 100 } });
  return { id: row.id, emitter, pipeline };
}
function evidence(id: string, emitter: string, occurredAt = time, ledger = 101) {
  return {
    deploymentId: id,
    eventId: randomUUID(),
    kind: EventKind.RECEIVE as EventKind,
    ledger,
    txHash: randomBytes(32).toString("hex"),
    occurredAt,
    payload: { topics: ["charge", subscriber], value: "10000", contractAddress: emitter },
  };
}
function rpcEvent(event: ReturnType<typeof evidence>) {
  return {
    id: event.eventId,
    type: "contract",
    contractId: { contractId: () => event.payload.contractAddress },
    ledger: event.ledger,
    txHash: event.txHash,
    ledgerClosedAt: event.occurredAt.toISOString(),
    topic: [xdr.ScVal.scvSymbol("charge"), Address.fromString(subscriber).toScVal()],
    value: nativeToScVal(10000n, { type: "i128" }),
    inSuccessfulContractCall: true,
  };
}
const read = (id: string) => db.deployment.findUniqueOrThrow({ where: { id } });

describe("confirmed Subscription history with PostgreSQL ingestion/admission", () => {
  it.each(["SUBSCRIPTION", "SUBSCRIPTION_DEV"] as const)(
    "projects %s ledger time and replays duplicates monotonically",
    async (kind) => {
      const f = await fixture(kind);
      const event = evidence(f.id, f.emitter);
      mocks.rpc.getEvents.mockResolvedValue({ events: [rpcEvent(event)], latestLedger: 101 });
      expect((await pollEventsForWithOutcome(f.id)).status).toBe("complete");
      expect((await read(f.id)).lastChargedAt).toEqual(time);
      expect((await read(f.id)).nextChargeAt).toEqual(older);
      await projectSubscriptionCharge(evidence(f.id, f.emitter, newer), f.emitter);
      await projectSubscriptionCharge(event, f.emitter);
      await projectSubscriptionCharge(evidence(f.id, f.emitter, older), f.emitter);
      expect((await read(f.id)).lastChargedAt).toEqual(newer);
      expect((await read(f.id)).chargeScheduleRevision).toBe(0);
      expect(mocks.rpc.sendTransaction).not.toHaveBeenCalled();
    },
  );
  it("holds the cursor after projection failure and repairs an already-inserted duplicate", async () => {
    const f = await fixture();
    const event = evidence(f.id, f.emitter);
    mocks.rpc.getEvents.mockResolvedValue({ events: [rpcEvent(event)], latestLedger: 101 });
    const update = db.deployment.updateMany.bind(db.deployment);
    const spy = vi.spyOn(db.deployment, "updateMany").mockImplementationOnce(() => {
      throw new Error("test projection checkpoint failure");
    });
    try {
      const first = await pollEventsForWithOutcome(f.id);
      expect(first.status).toBe("partial");
      expect(first.written).toBe(1);
      expect(await db.contractEvent.count({ where: { deploymentId: f.id } })).toBe(1);
      expect((await read(f.id)).lastChargedAt).toBeNull();
      expect(
        (await db.eventCursor.findUniqueOrThrow({ where: { deploymentId: f.id } })).lastLedger,
      ).toBe(100);
      expect(mocks.invalidate).toHaveBeenCalledOnce();
      expect(mocks.publish).toHaveBeenCalledOnce();
      spy.mockImplementation(update);
      const retry = await pollEventsForWithOutcome(f.id);
      expect(retry.status).toBe("complete");
      expect(retry.written).toBe(0);
      expect((await read(f.id)).lastChargedAt).toEqual(time);
      expect(await db.contractEvent.count({ where: { deploymentId: f.id } })).toBe(1);
      expect(mocks.publish).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });
  it.each(["PLATFORM", "USER", "MANUAL"] as const)(
    "repairs retained %s history behind the cursor even if RPC is unavailable",
    async (mode) => {
      const f = await fixture();
      await db.deployment.update({
        where: { id: f.id },
        data: { chargeRelayerMode: mode, nextChargeAt: null },
      });
      await db.eventCursor.update({ where: { deploymentId: f.id }, data: { lastLedger: 400 } });
      await db.contractEvent.create({ data: evidence(f.id, f.emitter) });
      mocks.rpc.getEvents.mockRejectedValue(new Error("RPC unavailable"));
      mocks.rpc.getHealth.mockRejectedValue(new Error("RPC unavailable"));
      await pollEventsForWithOutcome(f.id);
      const row = await read(f.id);
      expect(row.lastChargedAt).toEqual(time);
      expect(row.chargeRelayerMode).toBe(mode);
      expect(row.nextChargeAt).toBeNull();
      expect(
        (await db.eventCursor.findUniqueOrThrow({ where: { deploymentId: f.id } })).lastLedger,
      ).toBe(400);
      expect(mocks.rpc.sendTransaction).not.toHaveBeenCalled();
    },
  );
  it("filters unrelated later rows before the stored history limit", async () => {
    const f = await fixture();
    await db.contractEvent.create({ data: evidence(f.id, f.emitter) });
    await db.contractEvent.createMany({
      data: Array.from({ length: 150 }, () => ({
        ...evidence(f.id, f.emitter, newer),
        payload: { topics: ["receive", subscriber], value: "10000", contractAddress: f.emitter },
      })),
    });
    await pollEventsForWithOutcome(f.id);
    expect((await read(f.id)).lastChargedAt).toEqual(time);
  });
  it("limits retirement history to its cutoff and never resumes retired service", async () => {
    const f = await fixture();
    await db.contractEvent.createMany({
      data: [evidence(f.id, f.emitter, older, 99), evidence(f.id, f.emitter, newer, 102)],
    });
    await db.deployment.update({
      where: { id: f.id },
      data: {
        serviceState: "RETIRING",
        retirementRequestedAt: time,
        retirementCutoffLedger: 100,
        chargeRelayerMode: "MANUAL",
        nextChargeAt: null,
      },
    });
    expect((await pollEventsForWithOutcome(f.id)).status).toBe("skipped");
    await pollEventsForWithOutcome(f.id, { retirementCutoff: 100 });
    expect((await read(f.id)).lastChargedAt).toEqual(older);
    await db.deployment.update({
      where: { id: f.id },
      data: { serviceState: "RETIRED", retiredAt: newer, retirementReconciledAt: newer },
    });
    mocks.rpc.getEvents.mockClear();
    await projectSubscriptionCharge(evidence(f.id, f.emitter, newer), f.emitter);
    expect((await pollEventsForWithOutcome(f.id)).status).toBe("skipped");
    expect((await read(f.id)).lastChargedAt).toEqual(older);
    expect(mocks.rpc.getEvents).not.toHaveBeenCalled();
  });
  it.each(["emitter", "kind", "topic", "amount", "failure", "subscriber", "hash"])(
    "rejects invalid %s evidence",
    async (bad) => {
      const f = await fixture();
      const event = evidence(f.id, f.emitter);
      const payload: Record<string, unknown> = event.payload;
      if (bad === "emitter") payload.contractAddress = StrKey.encodeContract(randomBytes(32));
      if (bad === "kind") event.kind = EventKind.PAYOUT;
      if (bad === "topic") payload.topics = ["deposit", subscriber];
      if (bad === "amount") payload.value = "-1";
      if (bad === "failure") payload.inSuccessfulContractCall = false;
      if (bad === "subscriber") payload.topics = ["charge", "invalid"];
      if (bad === "hash") event.txHash = "unknown";
      await projectSubscriptionCharge(event, f.emitter);
      expect((await read(f.id)).lastChargedAt).toBeNull();
    },
  );
  it("requires an unambiguous deployed subscription snapshot and excludes Payroll", () => {
    const address = StrKey.encodeContract(randomBytes(32));
    const pipeline = [{ nodeId: "sub", contractAddress: address, templateKind: "SUBSCRIPTION" }];
    expect(subscriptionBillingEmitter(pipeline, "SUBSCRIPTION")).toBe(address);
    expect(subscriptionBillingEmitter(pipeline, "PAYROLL")).toBeNull();
    expect(subscriptionBillingEmitter([...pipeline, ...pipeline], "SUBSCRIPTION")).toBeNull();
    expect(
      subscriptionBillingEmitter([{ ...pipeline[0], templateKind: "PAYER" }], "SUBSCRIPTION"),
    ).toBeNull();
    expect(subscriptionBillingEmitter(null, "SUBSCRIPTION")).toBeNull();
  });
});

describe("database-maintained scheduling revisions", () => {
  it("advances every config/schedule/lifecycle observation, including no-op and ABA writes", async () => {
    const f = await fixture();
    const writes: Prisma.DeploymentUpdateInput[] = [
      { nextChargeAt: older },
      { chargeRelayerMode: "MANUAL" },
      { chargeRelayerMode: "PLATFORM" },
      { chargeRelayerAddress: subscriber },
      { chargeRelayerUrl: "https://example.invalid" },
      { chargeRelayerToken: "test-only" },
      { chargeEndAt: newer },
      { serviceState: "RETIRING", retirementRequestedAt: time },
    ];
    for (const [i, data] of writes.entries()) {
      await db.deployment.update({ where: { id: f.id }, data });
      expect((await read(f.id)).chargeScheduleRevision).toBe(i + 1);
    }
    await db.deployment.update({
      where: { id: f.id },
      data: { lastChargedAt: time, eventsPolledAt: newer },
    });
    expect((await read(f.id)).chargeScheduleRevision).toBe(writes.length);
  });
  it("allows one current checkpoint and fences stale, ABA, cancelled and retired refreshes", async () => {
    const f = await fixture();
    await refreshSubscriptionSchedule(f.id, 0, { nextChargeAt: time });
    expect((await read(f.id)).chargeScheduleRevision).toBe(1);
    await refreshSubscriptionSchedule(f.id, 0, { nextChargeAt: newer });
    expect((await read(f.id)).nextChargeAt).toEqual(time);
    await db.deployment.update({
      where: { id: f.id },
      data: { chargeRelayerMode: "MANUAL", nextChargeAt: null },
    });
    await refreshSubscriptionSchedule(f.id, 1, { nextChargeAt: newer });
    expect((await read(f.id)).nextChargeAt).toBeNull();
    await db.deployment.update({
      where: { id: f.id },
      data: { chargeRelayerMode: "PLATFORM", nextChargeAt: time },
    });
    await refreshSubscriptionSchedule(f.id, 1, { nextChargeAt: older });
    expect((await read(f.id)).nextChargeAt).toEqual(time);
    const revision = (await read(f.id)).chargeScheduleRevision;
    await db.deployment.update({
      where: { id: f.id },
      data: { serviceState: "RETIRING", retirementRequestedAt: time, nextChargeAt: null },
    });
    await refreshSubscriptionSchedule(f.id, revision, { nextChargeAt: newer });
    expect((await read(f.id)).nextChargeAt).toBeNull();
  });
});
