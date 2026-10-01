import { beforeEach, describe, expect, it, vi } from "vitest";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { STARTER_GRAPH } from "@/lib/flows/starter";

const mock = vi.hoisted(() => ({
  deployment: vi.fn(),
  create: vi.fn(),
  find: vi.fn(),
  claim: vi.fn(),
  update: vi.fn(),
  cursor: vi.fn(),
  getEvents: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    deployment: { findUnique: mock.deployment },
    contractEvent: { create: mock.create, findMany: mock.find },
    emailNotification: { createMany: mock.claim, update: mock.update },
    eventCursor: { updateMany: mock.cursor, createMany: vi.fn() },
  },
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ getEvents: mock.getEvents, getHealth: async () => null }),
}));
vi.mock("@/lib/redis", () => ({ redis: () => null, eventChannel: () => "events" }));
vi.mock("@/lib/mail", () => ({ sendEmail: mock.send }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true, shared: true }) }));
import { pollEventsFor } from "@/lib/stellar/events";

const graph = FlowGraphSchema.parse(STARTER_GRAPH);
graph.notify = { mode: "every_transaction", sendTo: "owner@example.com" };
const split = graph.nodes.find((n) => n.type === "split")!;
if (split.type !== "split") throw new Error("fixture");
const addresses = split.config.recipients.map((r) => r.address);
const saved = new Map<string, Record<string, unknown>>();
const claims = new Set<string>();
function rpcEvent(id: string, topic: string[], value: unknown) {
  return {
    id,
    topic: topic.map((v) => nativeToScVal(v)),
    value: nativeToScVal(value),
    ledger: 10,
    txHash: "shared-tx",
    ledgerClosedAt: "2026-10-01T00:00:00Z",
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  saved.clear();
  claims.clear();
  mock.deployment.mockResolvedValue({
    id: "dep",
    owner: { role: "USER" },
    contractAddress: "root",
    status: "CONFIRMED",
    cursor: { lastLedger: 9 },
    flow: { name: "Split", templateKind: "SPLITTER" },
    network: "testnet",
    graphSnapshot: graph,
    pipelineSnapshot: [
      { nodeId: graph.nodes[0]!.id, contractAddress: "root", templateKind: "DEPOSIT_TRIGGER" },
      { nodeId: split.id, contractAddress: "split", templateKind: "SPLITTER" },
    ],
  });
  mock.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    const id = String(data.eventId);
    if (saved.has(id)) throw { code: "P2002" };
    const row = { ...data, id };
    saved.set(id, row);
    return row;
  });
  mock.find.mockImplementation(async () => [...saved.values()]);
  mock.claim.mockImplementation(async ({ data }: { data: { deliveryKey: string }[] }) => {
    if (claims.has(data[0]!.deliveryKey)) return { count: 0 };
    claims.add(data[0]!.deliveryKey);
    return { count: 1 };
  });
  mock.update.mockResolvedValue({});
  mock.cursor.mockResolvedValue({ count: 1 });
  mock.send.mockResolvedValue({ ok: true, id: "sent" });
  mock.getEvents.mockImplementation(
    async ({ filters }: { filters: { contractIds: string[] }[] }) => {
      return {
        latestLedger: 10,
        events:
          filters[0]!.contractIds[0] === "root"
            ? [rpcEvent("receive", ["deposit", addresses[0]!], "1000000000")]
            : [
                rpcEvent("pay-a", ["pay", addresses[0]!], ["USDC", "400000000"]),
                rpcEvent("pay-b", ["pay", addresses[1]!], ["USDC", "600000000"]),
              ],
      };
    },
  );
});

describe("email dispatch after persisted event polling", () => {
  it("waits for all pipeline contracts before sending a single transaction summary", async () => {
    expect(await pollEventsFor("dep")).toBe(3);
    expect(saved.size).toBe(3);
    expect(mock.send).toHaveBeenCalledTimes(1);
    expect(mock.send.mock.calls[0]![0].text).toContain("40 USDC");
    expect(mock.send.mock.calls[0]![0].text).toContain("60 USDC");
    expect(mock.send.mock.invocationCallOrder[0]).toBeGreaterThan(
      mock.create.mock.invocationCallOrder.at(-1)!,
    );
    expect(mock.cursor.mock.invocationCallOrder[0]).toBeGreaterThan(
      mock.send.mock.invocationCallOrder[0]!,
    );
  });
  it("re-polling existing rows sends no duplicate", async () => {
    await pollEventsFor("dep");
    expect(await pollEventsFor("dep")).toBe(0);
    expect(mock.send).toHaveBeenCalledTimes(1);
  });
  it("a failed contract scan sends nothing until a complete retry", async () => {
    const original = mock.getEvents.getMockImplementation()!;
    mock.getEvents.mockImplementation(async (...args) => {
      if (args[0].filters[0].contractIds[0] === "split") throw new Error("RPC unavailable");
      return original(...args);
    });
    expect(await pollEventsFor("dep")).toBe(1);
    expect(mock.send).not.toHaveBeenCalled();
    expect(mock.cursor).not.toHaveBeenCalled();
    mock.getEvents.mockImplementation(original);
    expect(await pollEventsFor("dep")).toBe(2);
    expect(mock.send).toHaveBeenCalledTimes(1);
  });
});
