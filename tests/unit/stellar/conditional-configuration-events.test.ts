import { beforeEach, describe, expect, it, vi } from "vitest";
import { scValToNative } from "@stellar/stellar-sdk";
import type { ContractEvent, Prisma } from "@prisma/client";
import { conditionalDeploymentFixture } from "@/tests/fixtures/conditional-deployment";
import { conditionalNodeStateScVal } from "@/lib/stellar/conditional-v2-codec";
const mocks = vi.hoisted(() => ({ deployment: vi.fn(), update: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    deployment: { findUniqueOrThrow: mocks.deployment },
    contractEvent: { update: mocks.update },
  },
}));
vi.mock("@/lib/mutations/conditional-history", async (original) => ({
  ...(await original<typeof import("@/lib/mutations/conditional-history")>()),
  recordConditionalConfigurationObservation: mocks.record,
}));
import { projectConditionalConfigurationEvent } from "@/lib/stellar/conditional-configuration-events";
import { projectConditionalRouteEvent } from "@/lib/stellar/conditional-route-events";

function json(value: unknown): unknown {
  if (typeof value === "bigint") return String(value);
  if (Array.isArray(value)) return value.map(json);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, value]) => [key, json(value)]));
  return value;
}
let fixture: ReturnType<typeof conditionalDeploymentFixture>;
function configEvent() {
  const state = structuredClone(fixture.plan.manifest.nodes[2]!.state);
  state.revision = "1";
  if (state.configuration.kind === "condition") state.configuration.thresholdStroops = "200";
  return {
    state,
    event: {
      deploymentId: fixture.deployment.id,
      eventId: "event-config",
      txHash: "aa".repeat(32),
      ledger: 20,
      payload: {
        topics: ["config_v2", state.nodeId],
        contractAddress: state.contractAddress,
        value: json(scValToNative(conditionalNodeStateScVal(state))),
      },
    },
  };
}
function routeEvent() {
  const condition = fixture.plan.manifest.nodes[2]!.state;
  return {
    deploymentId: fixture.deployment.id,
    eventId: "event-route",
    txHash: "bb".repeat(32),
    ledger: 20,
    payload: {
      topics: ["route_v2", condition.nodeId],
      contractAddress: condition.contractAddress,
      value: json({
        root: fixture.plan.manifest.rootContract,
        payer: fixture.plan.definition.owner,
        nonce: Buffer.alloc(32, 17),
        amount_at_condition: 111n,
        selected_branch: ["False"],
        condition_revision: 4n,
        bindings: fixture.plan.bindings.map((binding, index) => ({
          node_id: binding.nodeId,
          contract_address: binding.contractAddress,
          expected_revision: index === 2 ? 4n : 0n,
          wasm_hash: Buffer.from(binding.wasmHash, "hex"),
        })),
      }),
    },
  };
}
const project = (event: ReturnType<typeof configEvent>["event"]) =>
  projectConditionalConfigurationEvent({ ...event, payload: event.payload as Prisma.JsonObject });
beforeEach(() => {
  vi.clearAllMocks();
  fixture = conditionalDeploymentFixture(true);
  mocks.deployment.mockResolvedValue(fixture.deployment);
  mocks.record.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue({});
});

describe("conditional configuration event evidence", () => {
  it("restores exact JSON integer positions, binds initial evidence and enriches one public full-state revision", async () => {
    const { event, state } = configEvent();
    expect(await project(event)).toEqual(state);
    expect(mocks.record).toHaveBeenCalledWith(fixture.deployment.id, state, 20, {
      eventId: event.eventId,
      txHash: event.txHash,
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { eventId: event.eventId },
      data: { kind: "STATUS_CHANGE", decodedData: { configuration: state } },
    });
    expect(JSON.stringify(mocks.update.mock.calls)).not.toContain("privateAuthoring");
  });
  it.each([1, 3, 4])(
    "restores mutable Pay/Split ABI integer positions for node %s",
    async (index) => {
      const state = structuredClone(fixture.plan.manifest.nodes[index]!.state);
      state.revision = "1";
      const event = {
        deploymentId: fixture.deployment.id,
        eventId: `event-${index}`,
        txHash: "ac".repeat(32),
        ledger: 21,
        payload: {
          topics: ["config_v2", state.nodeId],
          contractAddress: state.contractAddress,
          value: json(scValToNative(conditionalNodeStateScVal(state))),
        },
      };
      expect(await project(event)).toEqual(state);
      expect(mocks.record).toHaveBeenCalledWith(fixture.deployment.id, state, 21, {
        eventId: event.eventId,
        txHash: event.txHash,
      });
    },
  );
  it.each([
    "topics",
    "extraTopic",
    "emitter",
    "node",
    "constant",
    "revision",
    "noncanonical",
    "numeric",
    "unknown",
    "asset",
    "owner",
  ])("refuses %s projection without history writes", async (attack) => {
    const { event } = configEvent();
    const payload = event.payload;
    const value = payload.value as Record<string, unknown>;
    const config = (value.configuration as [string, Record<string, unknown>])[1];
    if (attack === "topics") payload.topics = ["config_v2"];
    if (attack === "extraTopic") payload.topics.push("extra");
    if (attack === "emitter") payload.contractAddress = fixture.plan.bindings[0]!.contractAddress;
    if (attack === "node") payload.topics[1] = "foreign";
    if (attack === "constant") config.threshold_mode = ["Constant"];
    if (attack === "revision") value.revision = "0";
    if (attack === "noncanonical") config.threshold = "0200";
    if (attack === "numeric") config.threshold = 200;
    if (attack === "unknown") value.contact = "private";
    if (attack === "asset") value.asset = fixture.plan.bindings[0]!.contractAddress;
    if (attack === "owner") value.admin = fixture.plan.bindings[0]!.contractAddress;
    await expect(project(event)).rejects.toBeDefined();
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("never projects explicitly failed contract calls", async () => {
    const { event } = configEvent();
    Object.assign(event.payload, { inSuccessfulContractCall: false });
    expect(await project(event)).toBeUndefined();
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("retains failed projection for a replay instead of declaring it complete", async () => {
    const { event, state } = configEvent();
    mocks.record.mockRejectedValueOnce(new Error("history unavailable"));
    await expect(project(event)).rejects.toThrow("history unavailable");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(await project(event)).toEqual(state);
    expect(mocks.record).toHaveBeenCalledTimes(2);
  });
});

describe("conditional route events are routing status only", () => {
  const projectRoute = (event: ReturnType<typeof routeEvent>) =>
    projectConditionalRouteEvent({ ...event, payload: event.payload as Prisma.JsonObject });
  it("strictly restores known32byte positions and binds complete historical evidence without inferring today's threshold", async () => {
    const event = routeEvent();
    const route = await projectRoute(event);
    expect(route).toMatchObject({
      version: 2,
      selectedBranch: "false",
      conditionRevision: "4",
      nonce: "11".repeat(32),
      amountAtConditionStroops: "111",
    });
    expect(route!.nodes).toHaveLength(5);
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.update.mock.calls[0]![0].data).toEqual({
      kind: "STATUS_CHANGE",
      decodedData: { route },
    });
  });
  it.each([
    "emitter",
    "root",
    "node",
    "nonce",
    "extraByte",
    "badByte",
    "bindingHash",
    "missingBinding",
    "reordered",
    "conditionRevision",
    "immutableRevision",
    "zeroAmount",
    "extra",
  ])("refuses %s route substitution", async (attack) => {
    const event = routeEvent();
    const raw = event.payload.value as Record<string, unknown>;
    const bindings = raw.bindings as Array<Record<string, unknown>>;
    if (attack === "emitter")
      event.payload.contractAddress = fixture.plan.bindings[0]!.contractAddress;
    if (attack === "root") raw.root = fixture.plan.bindings[1]!.contractAddress;
    if (attack === "node") event.payload.topics[1] = "other";
    if (attack === "nonce") raw.nonce = {};
    if (attack === "extraByte") (raw.nonce as Record<string, unknown>)["extra"] = 0;
    if (attack === "badByte") (raw.nonce as Record<string, unknown>)["0"] = 256;
    if (attack === "bindingHash")
      bindings[4]!.wasm_hash = Object.fromEntries(
        Array.from({ length: 32 }, (_, i) => [String(i), 0]),
      );
    if (attack === "missingBinding") bindings.pop();
    if (attack === "reordered") bindings.reverse();
    if (attack === "conditionRevision") raw.condition_revision = "3";
    if (attack === "immutableRevision") bindings[0]!.expected_revision = "1";
    if (attack === "zeroAmount") raw.amount_at_condition = "0";
    if (attack === "extra") raw.contact = "private";
    await expect(projectRoute(event)).rejects.toBeDefined();
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
