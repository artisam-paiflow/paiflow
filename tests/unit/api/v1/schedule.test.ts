import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
const mocks = vi.hoisted(() => ({
  state: vi.fn(),
  latest: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  retrieve: vi.fn(),
  create: vi.fn(),
  read: vi.fn(),
  submit: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock("@/lib/stellar/schedule-state", () => ({ readScheduleState: mocks.state }));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => ({ getLatestLedger: mocks.latest }) }));
vi.mock("@/lib/stellar/invoke", () => ({
  prepareStreamerPauseInvocation: mocks.pause,
  prepareStreamerUnpauseInvocation: mocks.resume,
  prepareStreamerRetrieveUnvestedInvocation: mocks.retrieve,
}));
vi.mock("@/lib/api/v1/control-intent", async (original) => ({
  ...(await original<typeof import("@/lib/api/v1/control-intent")>()),
  createControlIntent: mocks.create,
  readControlIntent: mocks.read,
  reconcileControlIntent: mocks.reconcile,
}));
vi.mock("@/lib/api/v1/control-submission", () => ({ submitControlIntent: mocks.submit }));
import {
  scheduleNode,
  scheduleState,
  assertScheduleEligible,
  prepareScheduleControl,
  submitScheduleControl,
  reconcileScheduleControl,
} from "@/lib/api/v1/schedule";
import {
  SchedulePrepareSchema,
  ScheduleReconcileSchema,
  ScheduleStateQuerySchema,
  ScheduleStateSchema,
} from "@/lib/api/v1/schema";
import { WalletControlSubmitSchema } from "@/lib/api/v1/control-intent";
import { DEPLOYMENT_ID, TRIGGER, PAYER } from "./execute-fixtures";
const wallet = Keypair.random().publicKey();
const intent = "00000000-0000-4000-8000-000000000001";
let deployment: Deployment;
const state = {
  controlEligibility: {
    walletProtocolSupported: true,
    pause: true,
    resume: false,
    retrieve: false,
  },
  controller: wallet,
  tokenContractAddress: PAYER,
  paused: false,
  pauseAllowed: true,
  retrieveAllowed: true,
  balanceStroops: "20000000",
  availableStroops: "10000000",
  claimedStroops: "0",
  unvestedStroops: "10000000",
  retrievableStroops: "0",
  retrievalRecipient: wallet,
  readAt: "2026-10-12T00:00:00.000Z",
};
beforeEach(() => {
  vi.clearAllMocks();
  deployment = {
    id: DEPLOYMENT_ID,
    network: "testnet",
    status: "CONFIRMED",
    sourceAccount: wallet,
    pipelineSnapshot: [{ nodeId: "schedule", templateKind: "STREAMER", contractAddress: TRIGGER }],
  } as unknown as Deployment;
  mocks.state.mockResolvedValue({ ...state });
  mocks.latest.mockResolvedValue({ sequence: 100 });
  for (const build of [mocks.pause, mocks.resume, mocks.retrieve])
    build.mockResolvedValue({ xdr: "unsigned" });
  mocks.create.mockResolvedValue({
    intent,
    txHash: "a".repeat(64),
    expiresAt: "2026-10-12T00:00:00.000Z",
  });
  mocks.read.mockResolvedValue({
    nodeId: "schedule",
    contractAddress: TRIGGER,
    walletAddress: wallet,
  });
  mocks.submit.mockResolvedValue({ status: "UNKNOWN" });
});
describe("Schedule domain", () => {
  it("uses the deployed snapshot, not mutable flow", async () => {
    const result = await scheduleState(deployment);
    expect(ScheduleStateSchema.parse(result)).toMatchObject(state);
    expect(mocks.state).toHaveBeenCalledWith(TRIGGER, wallet);
  });
  it.each([
    null,
    [],
    [{ nodeId: "schedule", templateKind: "WEBHOOK", contractAddress: TRIGGER }],
    [{ nodeId: "schedule", templateKind: "STREAMER", contractAddress: "invalid" }],
    [
      { nodeId: "same", templateKind: "STREAMER", contractAddress: TRIGGER },
      { nodeId: "same", templateKind: "STREAMER", contractAddress: PAYER },
    ],
  ])("rejects malformed/unsupported %j", (snapshot) => {
    deployment.pipelineSnapshot = snapshot;
    expect(() => scheduleNode(deployment)).toThrow();
  });
  it("requires nodeId for multiple distinct streamers", () => {
    deployment.pipelineSnapshot = [
      { nodeId: "a", templateKind: "STREAMER", contractAddress: TRIGGER },
      { nodeId: "b", templateKind: "STREAMER", contractAddress: PAYER },
    ];
    expect(() => scheduleNode(deployment)).toThrow();
    expect(scheduleNode(deployment, "b").contractAddress).toBe(PAYER);
    expect(() => scheduleNode(deployment, "missing")).toThrow();
  });
  it("rejects wrong network and unconfirmed deployments before RPC", () => {
    expect(() => scheduleNode({ ...deployment, network: "mainnet" })).toThrow();
    expect(() => scheduleNode({ ...deployment, status: "FAILED" })).toThrow();
    expect(mocks.state).not.toHaveBeenCalled();
  });
  it("does not grant controller consent to another wallet", async () => {
    await expect(
      assertScheduleEligible(deployment, "schedule", Keypair.random().publicKey(), "pause"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("refuses address-credential contract controllers", async () => {
    mocks.state.mockResolvedValue({ ...state, controller: PAYER });
    await expect(
      assertScheduleEligible(deployment, "schedule", wallet, "pause"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each([
    ["pause", { pauseAllowed: false }],
    ["pause", { paused: true }],
    ["resume", { paused: false }],
    ["resume", { paused: true, pauseAllowed: false }],
    ["retrieve", { paused: false }],
    ["retrieve", { paused: true, retrieveAllowed: false }],
    ["retrieve", { paused: true, retrievableStroops: "0" }],
  ] as const)("checks %s eligibility %j", async (action, override) => {
    mocks.state.mockResolvedValue({ ...state, ...override });
    await expect(
      assertScheduleEligible(deployment, "schedule", wallet, action),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each(["pause", "resume", "retrieve"] as const)(
    "prepares %s with ledger captured before builder",
    async (action) => {
      mocks.state.mockResolvedValue({
        ...state,
        paused: action !== "pause",
        retrievableStroops: "10000000",
      });
      const result = await prepareScheduleControl(deployment, action, { walletAddress: wallet });
      const build = { pause: mocks.pause, resume: mocks.resume, retrieve: mocks.retrieve }[action];
      expect(mocks.latest.mock.invocationCallOrder[0]).toBeLessThan(
        build.mock.invocationCallOrder[0]!,
      );
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeId: "schedule",
          action: `schedule.${action}`,
          preparationLedger: 100,
          unsignedXdr: "unsigned",
          walletAddress: wallet,
        }),
      );
      expect(result.unsignedXdr).toBe("unsigned");
      if (action === "retrieve")
        expect(result).toMatchObject({ recipient: wallet, estimatedAmountStroops: "10000000" });
    },
  );
  it("uses foundation with a live first-send eligibility callback and preserves UNKNOWN", async () => {
    const result = await submitScheduleControl({
      deployment,
      tokenId: intent,
      action: "pause",
      intent,
      signedXdr: "signed",
      ip: "127.0.0.1",
    });
    expect(result.status).toBe("UNKNOWN");
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "schedule.pause" }),
    );
    mocks.state.mockResolvedValue({ ...state, pauseAllowed: false });
    await expect(mocks.submit.mock.calls[0]![0].assertEligible()).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
  it.each(["PREPARED", "SUBMITTING", "SUCCESS", "FAILED", "EXPIRED"])(
    "only durable reconciliation grants replacement: %s",
    async (status) => {
      mocks.reconcile.mockResolvedValue({
        id: intent,
        txHash: "a".repeat(64),
        network: "testnet",
        state: status,
      });
      expect(await reconcileScheduleControl(deployment, "retrieve", intent)).toMatchObject({
        state: status,
        replacementAllowed: ["SUCCESS", "FAILED", "EXPIRED"].includes(status),
      });
      expect(mocks.reconcile).toHaveBeenCalledWith(intent, DEPLOYMENT_ID, "schedule.retrieve");
    },
  );
});
describe("strict Schedule requests", () => {
  it.each([
    { walletAddress: "invalid" },
    { walletAddress: wallet, nodeId: "" },
    { walletAddress: wallet, amountStroops: "1" },
    { walletAddress: wallet, recipient: wallet },
    { walletAddress: wallet, contractAddress: TRIGGER },
    { walletAddress: wallet, network: "mainnet" },
    { walletAddress: wallet, secretKey: "do-not-accept" },
    { walletAddress: wallet, nodeId: "n".repeat(129) },
  ])("rejects %j", (body) => {
    expect(SchedulePrepareSchema.safeParse(body).success).toBe(false);
  });
  it("rejects unknown query/reconcile/submit fields", () => {
    expect(ScheduleStateQuerySchema.safeParse({ contractAddress: TRIGGER }).success).toBe(false);
    expect(ScheduleReconcileSchema.safeParse({ intent, action: "pause" }).success).toBe(false);
    expect(
      WalletControlSubmitSchema.safeParse({ intent, signedXdr: "x", walletAddress: wallet })
        .success,
    ).toBe(false);
    expect(SchedulePrepareSchema.parse({ walletAddress: wallet })).toEqual({
      walletAddress: wallet,
    });
  });
});

describe("Schedule preparation race protection", () => {
  it("does not reserve an intent after configuration changes during simulation", async () => {
    mocks.state
      .mockResolvedValueOnce({ ...state })
      .mockResolvedValueOnce({ ...state, tokenContractAddress: TRIGGER });
    await expect(
      prepareScheduleControl(deployment, "pause", { walletAddress: wallet }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("Schedule first-send validation", () => {
  it("refuses a snapshot address change before first send", async () => {
    await submitScheduleControl({
      deployment,
      tokenId: intent,
      action: "pause",
      intent,
      signedXdr: "signed",
      ip: "127.0.0.1",
    });
    deployment.pipelineSnapshot = [
      { nodeId: "schedule", templateKind: "STREAMER", contractAddress: PAYER },
    ];
    await expect(mocks.submit.mock.calls[0]![0].assertEligible()).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
  it("refuses a different live controller before first send", async () => {
    await submitScheduleControl({
      deployment,
      tokenId: intent,
      action: "pause",
      intent,
      signedXdr: "signed",
      ip: "127.0.0.1",
    });
    mocks.state.mockResolvedValue({ ...state, controller: Keypair.random().publicKey() });
    await expect(mocks.submit.mock.calls[0]![0].assertEligible()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("classifies preparation RPC failures without persisting intents", async () => {
    mocks.pause.mockRejectedValue(new Error("raw rpc diagnostics"));
    await expect(
      prepareScheduleControl(deployment, "pause", { walletAddress: wallet }),
    ).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
