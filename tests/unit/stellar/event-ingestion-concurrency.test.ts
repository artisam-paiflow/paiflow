/**
 * Real PostgreSQL ingestion tests. Only RPC and external side effects are mocked.
 * A Prisma query extension pauses real statements to force race orderings and
 * injects an invalid foreign key to exercise an actual database insert failure.
 * Fixtures are unique per case; cleanup never wipes another suite's rows.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { Contract, StrKey, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { Prisma, TemplateKind } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { sorobanRpc } from "@/lib/stellar/client";
import { EVENTS_PAGE_LIMIT, pollEventsForWithOutcome } from "@/lib/stellar/events";

const controls = vi.hoisted(() => ({
  beforeInsert: undefined as ((args: Prisma.ContractEventCreateArgs) => Promise<void>) | undefined,
  beforeCursorCreate: undefined as (() => Promise<void>) | undefined,
  insertErrors: [] as unknown[],
  cursorCreates: [] as number[],
  publish: vi.fn(async () => 0),
  invalidate: vi.fn(),
  notify: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    db: actual.db.$extends({
      query: {
        contractEvent: {
          async create({ args, query }) {
            await controls.beforeInsert?.(args);
            try {
              return await query(args);
            } catch (error) {
              controls.insertErrors.push(error);
              throw error;
            }
          },
        },
        eventCursor: {
          async createMany({ args, query }) {
            await controls.beforeCursorCreate?.();
            const result = await query(args);
            controls.cursorCreates.push(result.count);
            return result;
          },
        },
      },
    }),
  };
});
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: vi.fn() }));
vi.mock("@/lib/redis", () => ({
  redis: () => ({ status: "ready", publish: controls.publish }),
  eventChannel: (id: string) => `events:${id}`,
}));
vi.mock("@/lib/stellar/dashboard-balance-cache", () => ({
  invalidateDashboardBalances: controls.invalidate,
}));
vi.mock("@/lib/flow-notifications", () => ({
  sendEmailNotificationsForTransactions: controls.notify,
}));

const OTHER = StrKey.encodeContract(Buffer.alloc(32, 2));
const SENDER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
const suffix = randomUUID();
let userId: string;
let flowId: string;
const deployments: string[] = [];

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

function event(id: string, ledger: number, contractAddress: string): rpc.Api.EventResponse {
  return {
    id,
    type: "contract",
    contractId: new Contract(contractAddress),
    topic: [nativeToScVal("payout", { type: "symbol" }), nativeToScVal(SENDER)],
    value: nativeToScVal([{ address: SENDER, bps: 10000, amount: "100" }]),
    ledger,
    // Two different event IDs may belong to the same transaction.
    txHash: "a".repeat(64),
    ledgerClosedAt: "2026-10-06T00:00:00Z",
    inSuccessfulContractCall: true,
    transactionIndex: 1,
    operationIndex: 1,
  };
}

function page(events: rpc.Api.EventResponse[], latestLedger: number): rpc.Api.GetEventsResponse {
  return {
    events,
    latestLedger,
    oldestLedger: 1,
    latestLedgerCloseTime: "1791244800",
    oldestLedgerCloseTime: "1791244000",
    cursor: `${BigInt(latestLedger) << 32n}-4294967295`,
  };
}

function breakForeignKey(args: Prisma.ContractEventCreateArgs) {
  if (typeof args.data.deploymentId !== "string") {
    throw new Error("Expected ingestion to insert using deploymentId");
  }
  args.data.deploymentId = randomUUID();
  // A concurrent reader may already have stored the original ID. Ensure its
  // unique constraint cannot mask the foreign-key failure being injected.
  args.data.eventId += "-foreign-key-failure";
}

function server(
  getEvents: (request: rpc.Server.GetEventsRequest) => Promise<rpc.Api.GetEventsResponse>,
) {
  const getEventsSpy = vi.fn(getEvents);
  vi.mocked(sorobanRpc).mockReturnValue({
    getEvents: getEventsSpy,
    getTransaction: async () => ({ status: "SUCCESS", ledger: 1000 }),
    getHealth: async () => ({ oldestLedger: 1, latestLedger: 2000 }),
  } as unknown as ReturnType<typeof sorobanRpc>);
  return getEventsSpy;
}

async function makeDeployment(options: { firstPoll?: boolean; grouped?: boolean } = {}) {
  const contractAddress = StrKey.encodeContract(randomBytes(32));
  const pipeline = options.grouped
    ? [
        ...Array.from({ length: 4 }, (_, index) => ({
          nodeId: `quiet-${index}`,
          contractAddress: StrKey.encodeContract(Buffer.alloc(32, index + 10)),
          templateKind: TemplateKind.SPLITTER,
        })),
        { nodeId: "other", contractAddress: OTHER, templateKind: TemplateKind.SPLITTER },
      ]
    : [];
  const deployment = await db.deployment.create({
    data: {
      flowId,
      ownerId: userId,
      network: "testnet",
      status: "CONFIRMED",
      contractAddress,
      deployTxHash: randomBytes(32).toString("hex"),
      graphSnapshot: {},
      paramsSnapshot: {},
      pipelineSnapshot: pipeline,
      ...(options.firstPoll ? {} : { cursor: { create: { lastLedger: 100 } } }),
    },
  });
  deployments.push(deployment.id);
  return { id: deployment.id, contractAddress };
}

const cursorOf = (deploymentId: string) =>
  db.eventCursor.findUniqueOrThrow({ where: { deploymentId } });
const rowsOf = (deploymentId: string) =>
  db.contractEvent.findMany({ where: { deploymentId }, orderBy: { eventId: "asc" } });

beforeAll(async () => {
  userId = (
    await db.user.create({ data: { username: `event-races-${suffix}`, passwordHash: "hash" } })
  ).id;
  flowId = (
    await db.flow.create({
      data: {
        ownerId: userId,
        name: "event races",
        templateKind: "SPLITTER",
        graph: {},
        parameters: {},
      },
    })
  ).id;
});

beforeEach(() => {
  vi.clearAllMocks();
  controls.insertErrors.length = 0;
  controls.cursorCreates.length = 0;
});

afterEach(() => {
  controls.beforeInsert = undefined;
  controls.beforeCursorCreate = undefined;
});

afterAll(async () => {
  await db.deployment.deleteMany({ where: { id: { in: deployments } } });
  if (flowId) await db.flow.deleteMany({ where: { id: flowId } });
  if (userId) await db.user.deleteMany({ where: { id: userId } });
});

describe("event ingestion with real PostgreSQL concurrency", () => {
  it("keeps newer coverage and freshness when a slower reader finishes last", async () => {
    const { id, contractAddress } = await makeDeployment();
    const shared = event(`${id}-shared`, 150, contractAddress);
    const newer = event(`${id}-newer`, 190, contractAddress);
    const releaseSlow = gate();
    let calls = 0;
    const requests = server(async () => {
      if (++calls === 1) {
        await releaseSlow.promise;
        return page([shared], 160);
      }
      return page([shared, newer], 200);
    });
    const slow = pollEventsForWithOutcome(id);
    try {
      await vi.waitFor(() => expect(calls).toBe(1));
      const fast = await pollEventsForWithOutcome(id);
      expect(fast).toMatchObject({ status: "complete", written: 2, scannedThrough: 200 });
      const before = await cursorOf(id);
      releaseSlow.open();
      expect(await slow).toMatchObject({ status: "complete", written: 0, scannedThrough: 160 });
      expect(await cursorOf(id)).toEqual(before);
      expect(requests.mock.calls.map(([request]) => request.startLedger)).toEqual([101, 101]);
      expect((await rowsOf(id)).map((row) => row.eventId)).toEqual([newer.id, shared.id]);
      expect(controls.publish).toHaveBeenCalledTimes(2);
      expect(controls.invalidate).toHaveBeenCalledTimes(2);
    } finally {
      releaseSlow.open();
      await slow;
    }
  });

  it("deduplicates racing inserts and settles racing first-cursor creation at the furthest ledger", async () => {
    const { id, contractAddress } = await makeDeployment({ firstPoll: true });
    const shared = event(`${id}-shared`, 1000, contractAddress);
    const inserts = gate();
    const cursorCreates = gate();
    let insertArrivals = 0;
    let cursorArrivals = 0;
    let calls = 0;
    controls.beforeInsert = async () => {
      insertArrivals++;
      await inserts.promise;
    };
    controls.beforeCursorCreate = async () => {
      cursorArrivals++;
      await cursorCreates.promise;
    };
    const requests = server(async () => page([shared], ++calls === 1 ? 1100 : 1200));
    const readers = [pollEventsForWithOutcome(id), pollEventsForWithOutcome(id)];
    try {
      await vi.waitFor(() => expect(insertArrivals).toBe(2));
      expect(await rowsOf(id)).toHaveLength(0);
      inserts.open();
      await vi.waitFor(() => expect(cursorArrivals).toBe(2));
      expect(await db.eventCursor.findUnique({ where: { deploymentId: id } })).toBeNull();
      cursorCreates.open();
      const results = await Promise.all(readers);
      expect(results.map((result) => result.status)).toEqual(["complete", "complete"]);
      expect(results.reduce((sum, result) => sum + result.written, 0)).toBe(1);
      expect(controls.cursorCreates.toSorted()).toEqual([0, 1]);
      expect(controls.insertErrors).toHaveLength(1);
      expect(controls.insertErrors[0]).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect(controls.insertErrors[0]).toMatchObject({ code: "P2002" });
      expect((await cursorOf(id)).lastLedger).toBe(1200);
      expect(await rowsOf(id)).toHaveLength(1);
      expect(requests.mock.calls.map(([request]) => request.startLedger)).toEqual([800, 800]);
      expect(controls.publish).toHaveBeenCalledTimes(1);
      expect(controls.invalidate).toHaveBeenCalledTimes(1);
    } finally {
      inserts.open();
      cursorCreates.open();
      await Promise.all(readers);
    }
  });

  it("holds coverage before a failed ledger, then retries missing rows and deduplicates stored events", async () => {
    const { id, contractAddress } = await makeDeployment();
    const events = [
      event(`${id}-0`, 140, contractAddress),
      event(`${id}-1`, 150, contractAddress),
      event(`${id}-2`, 150, contractAddress),
      event(`${id}-3`, 160, contractAddress),
    ];
    controls.beforeInsert = async (args) => {
      if (args.data.eventId === events[2]!.id) {
        // Fail inside PostgreSQL, rather than throwing a simulated Prisma error.
        breakForeignKey(args);
      }
    };
    const requests = server(async (request) =>
      page(
        events.filter((ev) => ev.ledger >= request.startLedger!),
        200,
      ),
    );
    expect(await pollEventsForWithOutcome(id)).toMatchObject({
      status: "partial",
      written: 2,
      scannedThrough: 149,
      reasons: ["insert-error"],
    });
    expect(controls.insertErrors[0]).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(controls.insertErrors[0]).toMatchObject({ code: "P2003" });
    expect((await cursorOf(id)).lastLedger).toBe(149);
    expect((await rowsOf(id)).map((row) => row.eventId)).toEqual(
      events.slice(0, 2).map((ev) => ev.id),
    );

    controls.beforeInsert = undefined;
    expect(await pollEventsForWithOutcome(id)).toMatchObject({
      status: "complete",
      written: 2,
      scannedThrough: 200,
      reasons: [],
    });
    expect((await cursorOf(id)).lastLedger).toBe(200);
    expect((await rowsOf(id)).map((row) => row.eventId)).toEqual(events.map((ev) => ev.id));
    expect(requests.mock.calls.map(([request]) => request.startLedger)).toEqual([101, 150]);
    expect(controls.publish).toHaveBeenCalledTimes(4);
    expect(controls.invalidate).toHaveBeenCalledTimes(4);
  });

  it.each([false, true])(
    "does not stamp or initialize a cursor when the first insert fails (first poll: %s)",
    async (firstPoll) => {
      const { id, contractAddress } = await makeDeployment({ firstPoll });
      const before = await db.eventCursor.findUnique({ where: { deploymentId: id } });
      const ev = event(`${id}-first`, firstPoll ? 800 : 101, contractAddress);
      controls.beforeInsert = async (args) => {
        breakForeignKey(args);
      };
      server(async () => page([ev], firstPoll ? 1200 : 200));
      expect(await pollEventsForWithOutcome(id)).toMatchObject({
        status: "failed",
        written: 0,
        reasons: ["insert-error"],
      });
      expect(await db.eventCursor.findUnique({ where: { deploymentId: id } })).toEqual(before);
      expect(await rowsOf(id)).toHaveLength(0);
      controls.beforeInsert = undefined;
      expect(await pollEventsForWithOutcome(id)).toMatchObject({ status: "complete", written: 1 });
      expect((await cursorOf(id)).lastLedger).toBe(firstPoll ? 1200 : 200);
      expect(await rowsOf(id)).toHaveLength(1);
    },
  );

  it("replays a full page when a later page fails in the same ledger", async () => {
    const { id, contractAddress } = await makeDeployment();
    const full = Array.from({ length: EVENTS_PAGE_LIMIT }, (_, index) =>
      event(`${id}-${String(index).padStart(3, "0")}`, 150, contractAddress),
    );
    const last = event(`${id}-last`, 150, contractAddress);
    controls.beforeInsert = async (args) => {
      if (args.data.eventId === last.id) breakForeignKey(args);
    };
    const requests = server(async (request) =>
      request.cursor ? page([last], 200) : { ...page(full, 200), cursor: page([], 150).cursor },
    );
    expect(await pollEventsForWithOutcome(id)).toMatchObject({
      status: "partial",
      written: EVENTS_PAGE_LIMIT,
      scannedThrough: 149,
      reasons: ["insert-error"],
    });
    expect((await cursorOf(id)).lastLedger).toBe(149);
    expect(await rowsOf(id)).toHaveLength(EVENTS_PAGE_LIMIT);
    expect(controls.insertErrors[0]).toMatchObject({ code: "P2003" });

    controls.beforeInsert = undefined;
    expect(await pollEventsForWithOutcome(id)).toMatchObject({
      status: "complete",
      written: 1,
      scannedThrough: 200,
    });
    expect((await cursorOf(id)).lastLedger).toBe(200);
    expect((await rowsOf(id)).map((row) => row.eventId)).toEqual(
      [...full, last].map((ev) => ev.id),
    );
    expect(requests.mock.calls.map(([request]) => request.startLedger)).toEqual([
      101,
      undefined,
      150,
      undefined,
    ]);
    expect(controls.publish).toHaveBeenCalledTimes(EVENTS_PAGE_LIMIT + 1);
    expect(controls.invalidate).toHaveBeenCalledTimes(EVENTS_PAGE_LIMIT + 1);
  });

  it("preserves another reader's durable progress when a stalled insert subsequently fails", async () => {
    const { id, contractAddress } = await makeDeployment();
    const ev = event(`${id}-shared`, 150, contractAddress);
    const release = gate();
    let arrivals = 0;
    controls.beforeInsert = async (args) => {
      if (++arrivals === 1) {
        await release.promise;
        breakForeignKey(args);
      }
    };
    server(async () => page([ev], 200));
    const failing = pollEventsForWithOutcome(id);
    try {
      await vi.waitFor(() => expect(arrivals).toBe(1));
      expect((await cursorOf(id)).lastLedger).toBe(100);
      expect(await rowsOf(id)).toHaveLength(0);
      expect(await pollEventsForWithOutcome(id)).toMatchObject({
        status: "complete",
        written: 1,
        scannedThrough: 200,
      });
      const before = await cursorOf(id);
      release.open();
      expect(await failing).toMatchObject({
        status: "partial",
        written: 0,
        scannedThrough: 149,
        reasons: ["insert-error"],
      });
      expect(await cursorOf(id)).toEqual(before);
      expect((await rowsOf(id)).map((row) => row.eventId)).toEqual([ev.id]);
      expect(controls.insertErrors[0]).toMatchObject({ code: "P2003" });
      expect(controls.publish).toHaveBeenCalledTimes(1);
      expect(controls.invalidate).toHaveBeenCalledTimes(1);
    } finally {
      release.open();
      await failing;
    }
  });

  it("limits a shared pipeline cursor to the group with an unstored event", async () => {
    const { id, contractAddress } = await makeDeployment({ grouped: true });
    const root = event(`${id}-root`, 180, contractAddress);
    const other = event(`${id}-other`, 150, OTHER);
    controls.beforeInsert = async (args) => {
      if (args.data.eventId === other.id) breakForeignKey(args);
    };
    const requests = server(async (request) =>
      page(request.filters![0]!.contractIds!.includes(OTHER) ? [other] : [root], 200),
    );
    expect(await pollEventsForWithOutcome(id)).toMatchObject({
      status: "partial",
      written: 1,
      scannedThrough: 149,
      reasons: ["insert-error"],
    });
    expect((await cursorOf(id)).lastLedger).toBe(149);
    expect((await rowsOf(id)).map((row) => row.eventId)).toEqual([root.id]);
    controls.beforeInsert = undefined;
    expect(await pollEventsForWithOutcome(id)).toMatchObject({
      status: "complete",
      written: 1,
      scannedThrough: 200,
    });
    expect((await cursorOf(id)).lastLedger).toBe(200);
    expect((await rowsOf(id)).map((row) => row.eventId)).toEqual([other.id, root.id]);
    expect(requests.mock.calls.map(([request]) => request.startLedger)).toEqual([
      101, 101, 150, 150,
    ]);
    expect(controls.publish).toHaveBeenCalledTimes(2);
    expect(controls.invalidate).toHaveBeenCalledTimes(2);
  });
});
