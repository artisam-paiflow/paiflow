import { beforeEach, describe, expect, it, vi } from "vitest";
import { nativeToScVal } from "@stellar/stellar-sdk";
import type { Prisma } from "@prisma/client";
import { conditionalDeploymentFixture } from "@/tests/fixtures/conditional-deployment";
import { conditionalNodeStateScVal } from "@/lib/stellar/conditional-v2-codec";
const mocks = vi.hoisted(() => ({
  deployment: vi.fn(),
  create: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  cursor: vi.fn(),
  record: vi.fn(),
  events: vi.fn(),
  publish: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    deployment: { findUnique: mocks.deployment, findUniqueOrThrow: mocks.deployment },
    contractEvent: { create: mocks.create, findUniqueOrThrow: mocks.find, update: mocks.update },
    eventCursor: { updateMany: mocks.cursor, createMany: vi.fn() },
  },
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => ({ getEvents: mocks.events }) }));
vi.mock("@/lib/redis", () => ({
  redis: () => ({ status: "ready", publish: mocks.publish }),
  eventChannel: (id: string) => `events:${id}`,
}));
vi.mock("@/lib/stellar/dashboard-balance-cache", () => ({ invalidateDashboardBalances: vi.fn() }));
vi.mock("@/lib/deployments/service-work", () => ({
  runDeploymentWork: async (_id: string, _kind: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/lib/mutations/conditional-history", async (original) => ({
  ...(await original<typeof import("@/lib/mutations/conditional-history")>()),
  recordConditionalConfigurationObservation: mocks.record,
}));
import { pollEventsForWithOutcome } from "@/lib/stellar/events";
let fixture: ReturnType<typeof conditionalDeploymentFixture>;
let rows: Map<string, Record<string, unknown>>;
const configured = () => {
  const state = structuredClone(fixture.plan.manifest.nodes[2]!.state);
  state.revision = "1";
  if (state.configuration.kind === "condition") state.configuration.thresholdStroops = "200";
  return state;
};
function rpcEvent(
  topic: "config_v2" | "route_v2",
  value: ReturnType<typeof nativeToScVal>,
  successful = true,
) {
  return {
    id: "conditional-event",
    ledger: 20,
    txHash: "aa".repeat(32),
    ledgerClosedAt: "2026-11-14T00:00:00.000Z",
    inSuccessfulContractCall: successful,
    contractId: { contractId: () => fixture.plan.bindings[2]!.contractAddress },
    topic: [topic, "condition"].map((topic) => nativeToScVal(topic)),
    value,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture = conditionalDeploymentFixture(true);
  rows = new Map();
  mocks.deployment.mockResolvedValue({
    ...fixture.deployment,
    graphSnapshot: null,
    contractAddress: fixture.plan.manifest.rootContract,
    serviceState: "ACTIVE",
    flow: { templateKind: "PAYER" },
    cursor: { lastLedger: 10 },
  });
  mocks.cursor.mockResolvedValue({ count: 1 });
  mocks.record.mockResolvedValue(undefined);
  mocks.publish.mockResolvedValue(1);
  mocks.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    if (rows.has(String(data.eventId)))
      throw Object.assign(new Error("duplicate"), { code: "P2002" });
    const row = { ...data, id: "persisted-id" };
    rows.set(String(data.eventId), row);
    return row;
  });
  mocks.find.mockImplementation(async ({ where }: { where: { eventId: string } }) =>
    rows.get(where.eventId),
  );
  mocks.update.mockImplementation(
    async ({ where, data }: { where: { eventId: string }; data: Record<string, unknown> }) => {
      Object.assign(rows.get(where.eventId)!, data);
      return rows.get(where.eventId);
    },
  );
});
describe("conditional ingestion and cursor checkpoint", () => {
  it("retains failed raw configuration evidence, fences cursor before that ledger and retries duplicate rows before advancing", async () => {
    const state = configured();
    const event = rpcEvent("config_v2", conditionalNodeStateScVal(state));
    mocks.events.mockResolvedValue({ events: [event], latestLedger: 30 });
    mocks.record.mockRejectedValueOnce(new Error("history unavailable"));
    const first = await pollEventsForWithOutcome(fixture.deployment.id);
    expect(first).toMatchObject({
      status: "partial",
      written: 0,
      scannedThrough: 19,
      reasons: ["insert-error"],
    });
    expect(rows.size).toBe(1);
    expect((rows.get(event.id)!.payload as Prisma.JsonObject).topics).toEqual([
      "config_v2",
      "condition",
    ]);
    expect(mocks.cursor.mock.calls[0]![0].data.lastLedger).toBe(19);
    expect(mocks.publish).not.toHaveBeenCalled();
    const replay = await pollEventsForWithOutcome(fixture.deployment.id);
    expect(replay).toMatchObject({ status: "complete", written: 0, scannedThrough: 30 });
    expect(mocks.record).toHaveBeenCalledTimes(2);
    expect(rows.get(event.id)!.decodedData).toEqual({ configuration: state });
    expect(mocks.cursor.mock.calls.at(-1)![0].data.lastLedger).toBe(30);
  });
  it("publishes the same canonical full configuration persisted on a fresh row without raw authoring metadata", async () => {
    const state = configured();
    mocks.events.mockResolvedValue({
      events: [rpcEvent("config_v2", conditionalNodeStateScVal(state))],
      latestLedger: 30,
    });
    expect(await pollEventsForWithOutcome(fixture.deployment.id)).toMatchObject({
      status: "complete",
      written: 1,
    });
    const live = JSON.parse(mocks.publish.mock.calls[0]![1]);
    expect(live.kind).toBe("STATUS_CHANGE");
    expect(live.decodedData).toEqual(rows.get("conditional-event")!.decodedData);
    expect(live.decodedData).toEqual({ configuration: state });
    expect(JSON.stringify(live)).not.toContain("private@example.invalid");
  });
  it("restores raw byte objects for route status without payout or configuration-history side effects", async () => {
    const value = {
      root: fixture.plan.manifest.rootContract,
      payer: fixture.plan.definition.owner,
      nonce: Buffer.alloc(32, 1),
      amount_at_condition: 111n,
      selected_branch: ["False"],
      condition_revision: 1n,
      bindings: fixture.plan.bindings.map((node, i) => ({
        node_id: node.nodeId,
        contract_address: node.contractAddress,
        expected_revision: i === 2 ? 1n : 0n,
        wasm_hash: Buffer.from(node.wasmHash, "hex"),
      })),
    };
    mocks.events.mockResolvedValue({
      events: [rpcEvent("route_v2", nativeToScVal(value))],
      latestLedger: 30,
    });
    expect(await pollEventsForWithOutcome(fixture.deployment.id)).toMatchObject({
      status: "complete",
      written: 1,
    });
    expect(mocks.record).not.toHaveBeenCalled();
    const live = JSON.parse(mocks.publish.mock.calls[0]![1]);
    expect(live.kind).toBe("STATUS_CHANGE");
    expect(live.decodedData).toEqual(rows.get("conditional-event")!.decodedData);
    expect(live.decodedData.route).toMatchObject({
      nonce: "01".repeat(32),
      selectedBranch: "false",
      conditionRevision: "1",
    });
  });
  it("retains explicitly failed conditional calls as status only without projecting a configuration", async () => {
    mocks.events.mockResolvedValue({
      events: [rpcEvent("config_v2", conditionalNodeStateScVal(configured()), false)],
      latestLedger: 30,
    });
    expect(await pollEventsForWithOutcome(fixture.deployment.id)).toMatchObject({
      status: "complete",
      written: 1,
    });
    expect(mocks.record).not.toHaveBeenCalled();
    expect(rows.get("conditional-event")!.kind).toBe("STATUS_CHANGE");
    expect(
      (rows.get("conditional-event")!.payload as Prisma.JsonObject).inSuccessfulContractCall,
    ).toBe(false);
  });
});
