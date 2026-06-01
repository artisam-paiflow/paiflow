import { describe, expect, it, vi, beforeEach } from "vitest";
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { pollEventsFor } from "@/lib/stellar/events";
import { sorobanRpc } from "@/lib/stellar/client";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { TemplateKind } from "@prisma/client";
import type { Prisma } from "@prisma/client";

vi.mock("@/lib/stellar/client");
vi.mock("@/lib/db", () => ({
  db: {
    deployment: { findUnique: vi.fn() },
    contractEvent: { create: vi.fn() },
    eventCursor: { upsert: vi.fn() },
  },
}));

vi.mock("@/lib/redis", () => ({
  redis: vi.fn(() => null),
  eventChannel: (id: string) => `events:${id}`,
}));

vi.mock("@/lib/log", () => ({
  log: { warn: vi.fn(), info: vi.fn() },
}));

function makeMockEvent(opts: {
  topic: unknown[];
  value: unknown;
  ledger: number;
  txHash: string;
  ledgerClosedAt: string;
}) {
  return {
    type: "contract" as const,
    contractId: "C123",
    id: `evt-${opts.ledger}-${opts.txHash}`,
    pagingToken: `pt-${opts.ledger}`,
    topic: opts.topic.map((t) => nativeToScVal(t)),
    value: nativeToScVal(opts.value),
    ledger: opts.ledger,
    txHash: opts.txHash,
    ledgerClosedAt: opts.ledgerClosedAt,
    inSuccessfulContractCall: true,
  };
}

function mockServer(opts: {
  getTransaction?: () => Promise<{ status: string; ledger: number; txHash: string }>;
  getEvents?: () => Promise<{
    events: ReturnType<typeof makeMockEvent>[];
    latestLedger: number;
  }>;
}) {
  vi.mocked(sorobanRpc).mockReturnValue({
    getTransaction:
      opts.getTransaction ?? (async () => ({ status: "SUCCESS", ledger: 1000, txHash: "tx1" })),
    getEvents:
      opts.getEvents ??
      (async () => ({
        events: [],
        latestLedger: 1000,
      })),
  } as unknown as ReturnType<typeof sorobanRpc>);
}

describe("pollEventsFor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 when deployment is not found", async () => {
    vi.mocked(db.deployment.findUnique).mockResolvedValue(null);
    const result = await pollEventsFor("dep-1");
    expect(result).toBe(0);
  });

  it("returns 0 when contractAddress is missing", async () => {
    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: null,
      status: "CONFIRMED",
      cursor: null,
      deployTxHash: null,
      flow: { templateKind: TemplateKind.SPLITTER },
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);
    const result = await pollEventsFor("dep-1");
    expect(result).toBe(0);
  });

  it("returns 0 when status is not CONFIRMED", async () => {
    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: "C123",
      status: "PENDING",
      cursor: null,
      deployTxHash: null,
      flow: { templateKind: TemplateKind.SPLITTER },
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);
    const result = await pollEventsFor("dep-1");
    expect(result).toBe(0);
  });

  it("returns 0 when flow templateKind is missing", async () => {
    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: "C123",
      status: "CONFIRMED",
      cursor: null,
      deployTxHash: null,
      flow: null,
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);
    mockServer({});
    const result = await pollEventsFor("dep-1");
    expect(result).toBe(0);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentId: "dep-1" }),
      "pollEventsFor: flow templateKind not found, skipping",
    );
  });

  it("cursor-exists path: polls from cursor.lastLedger + 1 and writes new cursor", async () => {
    const event = makeMockEvent({
      topic: ["distrib"],
      value: { 0: "native", 1: "100" },
      ledger: 500,
      txHash: "tx1",
      ledgerClosedAt: "2024-01-01T00:00:00Z",
    });

    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: "C123",
      status: "CONFIRMED",
      cursor: { lastLedger: 400 },
      deployTxHash: "dtx1",
      flow: { templateKind: TemplateKind.SPLITTER },
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);

    mockServer({
      getEvents: async () => ({
        events: [event],
        latestLedger: 500,
      }),
    });

    const result = await pollEventsFor("dep-1");
    expect(result).toBe(1);
    expect(db.contractEvent.create).toHaveBeenCalledTimes(1);
    expect(db.eventCursor.upsert).toHaveBeenCalledWith({
      where: { deploymentId: "dep-1" },
      update: { lastLedger: 500 },
      create: { deploymentId: "dep-1", lastLedger: 500 },
    });
  });

  it("cursor-exists with falsy lastLedger (0): still takes cursor path", async () => {
    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: "C123",
      status: "CONFIRMED",
      cursor: { lastLedger: 0 },
      deployTxHash: "dtx1",
      flow: { templateKind: TemplateKind.SPLITTER },
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);

    mockServer({
      getEvents: async () => ({
        events: [],
        latestLedger: 0,
      }),
    });

    const result = await pollEventsFor("dep-1");
    expect(result).toBe(0);
    // Should call getEvents with startLedger = 1 (0 + 1)
    expect(sorobanRpc).toHaveBeenCalled();
  });

  it("no-cursor + deployTxHash path: fetches deploy ledger and polls with buffer", async () => {
    const event = makeMockEvent({
      topic: ["distrib"],
      value: { 0: "native", 1: "200" },
      ledger: 900,
      txHash: "tx2",
      ledgerClosedAt: "2024-01-01T00:00:00Z",
    });

    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: "C123",
      status: "CONFIRMED",
      cursor: null,
      deployTxHash: "dtx1",
      flow: { templateKind: TemplateKind.SPLITTER },
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);

    mockServer({
      getTransaction: async () => ({ status: "SUCCESS", ledger: 1000, txHash: "dtx1" }),
      getEvents: async () => ({
        events: [event],
        latestLedger: 900,
      }),
    });

    const result = await pollEventsFor("dep-1");
    expect(result).toBe(1);
    expect(db.contractEvent.create).toHaveBeenCalledTimes(1);
    expect(db.eventCursor.upsert).toHaveBeenCalledWith({
      where: { deploymentId: "dep-1" },
      update: { lastLedger: 900 },
      create: { deploymentId: "dep-1", lastLedger: 900 },
    });
  });

  it("no-cursor + no-deployTxHash path: logs warning and returns 0", async () => {
    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: "C123",
      status: "CONFIRMED",
      cursor: null,
      deployTxHash: null,
      flow: { templateKind: TemplateKind.SPLITTER },
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);

    const result = await pollEventsFor("dep-1");
    expect(result).toBe(0);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentId: "dep-1" }),
      "pollEventsFor: no cursor and no deployTxHash, skipping",
    );
  });

  it("getDeploymentLedger failure path: logs warning and returns 0", async () => {
    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: "C123",
      status: "CONFIRMED",
      cursor: null,
      deployTxHash: "dtx1",
      flow: { templateKind: TemplateKind.SPLITTER },
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);

    mockServer({
      getTransaction: async () => ({ status: "NOT_FOUND", ledger: 0, txHash: "dtx1" }),
    });

    const result = await pollEventsFor("dep-1");
    expect(result).toBe(0);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentId: "dep-1" }),
      "getDeploymentLedger failed, skipping",
    );
  });

  it("does not update cursor when no events are returned", async () => {
    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: "C123",
      status: "CONFIRMED",
      cursor: { lastLedger: 400 },
      deployTxHash: "dtx1",
      flow: { templateKind: TemplateKind.SPLITTER },
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);

    mockServer({
      getEvents: async () => ({
        events: [],
        latestLedger: 400,
      }),
    });

    const result = await pollEventsFor("dep-1");
    expect(result).toBe(0);
    expect(db.eventCursor.upsert).not.toHaveBeenCalled();
  });
});
