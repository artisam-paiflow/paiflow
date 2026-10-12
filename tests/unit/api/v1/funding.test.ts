import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  getter: vi.fn(),
  topup: vi.fn(),
  deposit: vi.fn(),
  ledger: vi.fn(),
  create: vi.fn(),
  read: vi.fn(),
  parse: vi.fn(),
}));
vi.mock("@/lib/stellar/streamer-config", () => ({ readStreamerConfig: mocks.config }));
vi.mock("@/lib/stellar/contract-read", () => ({ simulateGetter: mocks.getter }));
vi.mock("@/lib/stellar/invoke", () => ({
  prepareStreamerTopUpInvocation: mocks.topup,
  prepareWebhookDepositInvocation: mocks.deposit,
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => ({ getLatestLedger: mocks.ledger }) }));
vi.mock("@/lib/api/v1/control-intent", () => ({
  createControlIntent: mocks.create,
  readControlIntent: mocks.read,
  parseControlTransaction: mocks.parse,
}));
import {
  fundingNode,
  discoverFunding,
  prepareFunding,
  assertFundingEligible,
} from "@/lib/api/v1/funding";
import {
  FundingPrepareSchema,
  FundingSubmitSchema,
  FundingReconcileSchema,
} from "@/lib/api/v1/funding-schema";
import { fundingBody } from "@/lib/api/v1/funding-body";
import { deploymentCapabilities } from "@/lib/api/v1/capabilities";
import { DEPLOYMENT_ID, TRIGGER, PAYER } from "./execute-fixtures";
const from = Keypair.random().publicKey();
const admin = Keypair.random().publicKey();
const asset = PAYER;
const intent = "00000000-0000-4000-8000-000000000001";
function deployment(kind = "STREAMER"): Deployment {
  return {
    id: DEPLOYMENT_ID,
    network: "testnet",
    status: "CONFIRMED",
    pipelineSnapshot: [{ nodeId: "head", templateKind: kind, contractAddress: TRIGGER }],
    graphSnapshot: null,
    webhookSecret: "must-not-leak",
  } as unknown as Deployment;
}
const input = {
  fromAddress: from,
  tokenContractAddress: asset,
  amountStroops: "12345678901234567890",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.parse.mockReturnValue(
    new TransactionBuilder(new Account(from, "10"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        new Contract(TRIGGER).call(
          "top_up",
          new Address(from).toScVal(),
          nativeToScVal(BigInt(input.amountStroops), { type: "i128" }),
        ),
      )
      .setTimeout(180)
      .build(),
  );
  mocks.config.mockResolvedValue({ admin, asset });
  mocks.getter.mockResolvedValue(asset);
  mocks.ledger.mockResolvedValue({ sequence: 123 });
  mocks.topup.mockResolvedValue({ xdr: "schedule-xdr" });
  mocks.deposit.mockResolvedValue({ xdr: "webhook-xdr" });
  mocks.create.mockResolvedValue({
    intent,
    txHash: "a".repeat(64),
    expiresAt: "2026-10-14T00:00:00.000Z",
  });
  mocks.read.mockResolvedValue({ nodeId: "head", contractAddress: TRIGGER });
});
describe("funding eligibility and preparation", () => {
  it.each(["STREAMER", "WEBHOOK"])(
    "discovers live %s funding without leaking secrets",
    async (kind) => {
      const data = await discoverFunding(deployment(kind));
      expect(data.nodes[0]).toMatchObject({
        tokenContractAddress: asset,
        authorization: "funding_wallet",
      });
      expect(JSON.stringify(data)).not.toContain("must-not-leak");
    },
  );
  it.each(["STREAMER", "WEBHOOK"])(
    "accepts a consenting non-admin wallet for %s and binds precise amount",
    async (kind) => {
      expect(from).not.toBe(admin);
      const data = await prepareFunding(deployment(kind), input);
      expect(data).toMatchObject({ ...input, intent, nodeId: "head", network: "testnet" });
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          walletAddress: from,
          preparationLedger: 123,
          action: kind === "STREAMER" ? "schedule.fund" : "webhook.fund",
        }),
      );
      expect(kind === "STREAMER" ? mocks.topup : mocks.deposit).toHaveBeenCalledWith(
        expect.objectContaining({ amount: input.amountStroops, contractAddress: TRIGGER }),
      );
      expect(mocks.ledger.mock.invocationCallOrder[0]).toBeLessThan(
        (kind === "STREAMER" ? mocks.topup : mocks.deposit).mock.invocationCallOrder[0]!,
      );
    },
  );
  it("refuses a builder amount mismatch before creating the intent", async () => {
    await expect(
      prepareFunding(deployment(), { ...input, amountStroops: "1" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("refuses a caller-selected asset without simulating or storing an intent", async () => {
    await expect(
      prepareFunding(deployment(), { ...input, tokenContractAddress: TRIGGER }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(mocks.topup).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([null, 0, "bad", from])("fails closed on invalid Webhook asset %s", async (v) => {
    mocks.getter.mockResolvedValue(v);
    await expect(discoverFunding(deployment("WEBHOOK"))).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
    });
  });
  it("preserves RPC failure and creates no intent", async () => {
    mocks.config.mockRejectedValue(new Error("rpc"));
    await expect(prepareFunding(deployment(), input)).rejects.toThrow("rpc");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("resolves selected nodes from the snapshot, never the mutable graph", () => {
    const d = deployment();
    d.graphSnapshot = { nodes: [{ id: "arbitrary" }] };
    expect(fundingNode(d).contractAddress).toBe(TRIGGER);
  });
  it("requires explicit selection when several supported nodes exist", () => {
    const d = deployment();
    d.pipelineSnapshot = [
      ...(d.pipelineSnapshot as object[]),
      { nodeId: "second", templateKind: "WEBHOOK", contractAddress: PAYER },
    ];
    expect(() => fundingNode(d)).toThrow();
    expect(fundingNode(d, "second").contractAddress).toBe(PAYER);
  });
  it.each(["MULTISIG", "DEPOSIT_TRIGGER", "SUBSCRIPTION", "STREAMER_DEV", "PAYER"])(
    "refuses unsupported %s funding",
    (kind) => {
      expect(() => fundingNode(deployment(kind))).toThrow();
    },
  );
  it.each([
    null,
    {},
    [],
    [{ nodeId: "head", templateKind: "STREAMER", contractAddress: "bad" }],
    [
      { nodeId: "head", templateKind: "STREAMER", contractAddress: TRIGGER },
      { nodeId: "head", templateKind: "WEBHOOK", contractAddress: PAYER },
    ],
  ])("refuses malformed or ambiguous snapshot", (snapshot) => {
    const d = deployment();
    d.pipelineSnapshot = snapshot;
    expect(() => fundingNode(d)).toThrow();
    expect(deploymentCapabilities(d).operations.funding.status).toBe("unsupported");
  });
  it("refuses wrong network and unconfirmed deployments", () => {
    const d = deployment();
    d.network = "mainnet";
    expect(() => fundingNode(d)).toThrow();
    d.network = "testnet";
    d.status = "FAILED";
    expect(() => fundingNode(d)).toThrow();
  });
  it("checks intent-scoped node and action before first send", async () => {
    await assertFundingEligible(deployment(), intent, "schedule.fund");
    expect(mocks.read).toHaveBeenCalledWith(intent, DEPLOYMENT_ID, "schedule.fund");
    await expect(assertFundingEligible(deployment(), intent, "webhook.fund")).rejects.toThrow();
  });
  it("refuses changed contract before first send", async () => {
    mocks.read.mockResolvedValue({ nodeId: "head", contractAddress: PAYER });
    await expect(assertFundingEligible(deployment(), intent, "schedule.fund")).rejects.toThrow();
  });
});
describe("funding strict inputs and bounded bodies", () => {
  it.each(["0", "-1", "1.1", "01", "1e7", "", "9".repeat(40), String(1n << 127n), 12])(
    "refuses invalid stroop amount %s",
    (amountStroops) => {
      expect(FundingPrepareSchema.safeParse({ ...input, amountStroops }).success).toBe(false);
    },
  );
  it("accepts precise max i128", () => {
    expect(
      FundingPrepareSchema.parse({ ...input, amountStroops: String((1n << 127n) - 1n) })
        .amountStroops,
    ).toBe(String((1n << 127n) - 1n));
  });
  it.each([
    { secretKey: "bad" },
    { contractAddress: TRIGGER },
    { asset: "native" },
    { action: "schedule.pause" },
  ])("refuses extra preparation fields", (extra) => {
    expect(FundingPrepareSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  });
  it("refuses contract or malformed funders", () => {
    expect(FundingPrepareSchema.safeParse({ ...input, fromAddress: TRIGGER }).success).toBe(false);
  });
  it("restricts submit/reconcile to funding actions and precise protocol", () => {
    expect(
      FundingSubmitSchema.safeParse({ action: "schedule.pause", intent, signedXdr: "xdr" }).success,
    ).toBe(false);
    expect(
      FundingSubmitSchema.safeParse({
        action: "schedule.fund",
        intent,
        signedXdr: "xdr",
        amountStroops: "1",
      }).success,
    ).toBe(false);
    expect(FundingReconcileSchema.safeParse({ action: "webhook.fund", intent }).success).toBe(true);
  });
  it("parses valid JSON without Content-Length", async () => {
    expect(
      await fundingBody(
        new Request("https://test", { method: "POST", body: JSON.stringify(input) }),
      ),
    ).toEqual(input);
  });
  it.each(["{", "x".repeat(110001)])("rejects malformed or oversized bodies", async (body) => {
    await expect(
      fundingBody(new Request("https://test", { method: "POST", body })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
