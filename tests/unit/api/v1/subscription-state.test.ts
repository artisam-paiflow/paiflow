import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { Keypair } from "@stellar/stellar-sdk";

const mocks = vi.hoisted(() => ({
  db: {
    deploymentApiToken: { findUnique: vi.fn(), update: vi.fn() },
    deployment: { findFirst: vi.fn() },
  },
  subscriber: vi.fn(),
  asset: vi.fn(),
  cancelled: vi.fn(),
  allowance: vi.fn(),
  service: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/deployments/service-work", () => ({ assertDeploymentService: mocks.service }));
vi.mock("@/lib/stellar/relayer", () => ({
  readSubscriptionSubscriberNullable: mocks.subscriber,
  readSubscriptionAsset: mocks.asset,
  readSubscriptionIsCancelled: mocks.cancelled,
  readTokenAllowance: mocks.allowance,
}));
import { GET } from "@/app/api/v1/deployments/[id]/subscription/state/route";
import { AppError } from "@/lib/errors";
import { assetContractId } from "@/lib/stellar/assets";
import { SubscriptionStateSchema } from "@/lib/api/v1/schema";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { ctx, DEPLOYMENT_ID, newToken, tokenRow, TRIGGER, PAYER } from "./execute-fixtures";

const subscriber = Keypair.random().publicKey();
const originalSubscriber = Keypair.random().publicKey();
const graph = {
  nodes: [
    {
      id: "sub",
      type: "subscription",
      config: {
        subscriber: originalSubscriber,
        asset: { kind: "native" },
        amountPerPeriodStroops: "100",
      },
    },
  ],
  edges: [],
};
let token: ReturnType<typeof newToken>;
let deployment: Record<string, unknown>;
function authorize(overrides: Record<string, unknown> = {}) {
  deployment = {
    id: DEPLOYMENT_ID,
    network: "testnet",
    status: "CONFIRMED",
    serviceState: "ACTIVE",
    graphSnapshot: structuredClone(graph),
    flow: { name: "Club", templateKind: "SUBSCRIPTION" },
    pipelineSnapshot: [{ nodeId: "sub", templateKind: "SUBSCRIPTION", contractAddress: TRIGGER }],
    ...overrides,
  };
  mocks.db.deploymentApiToken.findUnique.mockResolvedValue(tokenRow(token, deployment));
  mocks.db.deployment.findFirst.mockResolvedValue(deployment);
}
function call(auth = `Bearer ${token.plaintext}`, id = DEPLOYMENT_ID) {
  return GET(
    new Request(`https://paiflow.test/api/v1/deployments/${id}/subscription/state`, {
      headers: { authorization: auth },
    }) as NextRequest,
    ctx(id),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  token = newToken();
  authorize();
  mocks.db.deploymentApiToken.update.mockResolvedValue({});
  mocks.service.mockResolvedValue(undefined);
  mocks.subscriber.mockResolvedValue(subscriber);
  mocks.asset.mockResolvedValue(assetContractId({ kind: "native" }));
  mocks.cancelled.mockResolvedValue(false);
  mocks.allowance.mockResolvedValue(12345678901234567890n);
});
describe("deployment-token Subscription state", () => {
  it.each(["SUBSCRIPTION", "SUBSCRIPTION_DEV"])(
    "reads live %s configuration without a session",
    async (kind) => {
      authorize({
        pipelineSnapshot: [{ nodeId: "sub", templateKind: kind, contractAddress: TRIGGER }],
      });
      const response = await call();
      expect(response.status).toBe(200);
      const data = SubscriptionStateSchema.parse((await response.json()).data);
      expect(data).toMatchObject({
        templateKind: kind,
        subscriber,
        allowance: "12345678901234567890",
        setupRequired: false,
        isCancelled: false,
        asset: { kind: "native" },
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(mocks.allowance).toHaveBeenCalledWith({
        tokenContractAddress: assetContractId({ kind: "native" }),
        owner: subscriber,
        spender: TRIGGER,
        classifyRpcFailures: true,
      });
    },
  );
  it("uses immutable deployment classification after mutable Flow metadata changes", async () => {
    authorize({ flow: { name: "Edited club", templateKind: "PAYROLL" } });
    expect((await call()).status).toBe(200);
  });
  it("returns explicit unconfigured Dev setup without making an allowance query", async () => {
    authorize({
      pipelineSnapshot: [
        { nodeId: "sub", templateKind: "SUBSCRIPTION_DEV", contractAddress: TRIGGER },
      ],
    });
    mocks.subscriber.mockResolvedValue(null);
    const response = await call();
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      subscriber: null,
      setupRequired: true,
      allowance: "0",
    });
    expect(mocks.allowance).not.toHaveBeenCalled();
  });
  it("refuses a missing ordinary subscriber rather than reporting Dev setup", async () => {
    mocks.subscriber.mockResolvedValue(null);
    expect((await call()).status).toBe(502);
    expect(mocks.allowance).not.toHaveBeenCalled();
  });
  it("reports cancellation and configured zero allowance independently of setup", async () => {
    mocks.cancelled.mockResolvedValue(true);
    mocks.allowance.mockResolvedValue(0n);
    expect((await (await call()).json()).data).toMatchObject({
      isCancelled: true,
      allowance: "0",
      setupRequired: false,
    });
  });
  it("does not label a mutated Dev asset with stale graph metadata", async () => {
    mocks.asset.mockResolvedValue(PAYER);
    expect((await (await call()).json()).data).toMatchObject({
      tokenContractAddress: PAYER,
      asset: null,
      assetLabel: PAYER,
    });
  });
  it.each(["subscriber", "asset", "cancelled", "allowance"] as const)(
    "propagates %s RPC failure",
    async (field) => {
      mocks[field].mockRejectedValue(new AppError("UPSTREAM_RPC", "Live state unavailable"));
      const response = await call();
      expect(response.status).toBe(502);
      expect((await response.json()).error.code).toBe("UPSTREAM_RPC");
    },
  );
  it.each([-1n, 1n << 127n])("rejects invalid allowance %s", async (value) => {
    mocks.allowance.mockResolvedValue(value);
    expect((await call()).status).toBe(502);
  });
  it.each([
    "payroll",
    "wrong-kind",
    "missing-graph",
    "ambiguous",
    "non-head",
    "wrong-network",
    "bad-address",
    "multiple-triggers",
  ])("refuses %s before chain reads", async (bad) => {
    const pipeline = [{ nodeId: "sub", templateKind: "SUBSCRIPTION", contractAddress: TRIGGER }];
    const recorded = structuredClone(graph);
    const overrides: Record<string, unknown> = {};
    if (bad === "payroll")
      overrides.graphSnapshot = { nodes: [{ ...recorded.nodes[0], type: "payroll" }], edges: [] };
    if (bad === "wrong-kind") pipeline[0]!.templateKind = "STREAMER";
    if (bad === "missing-graph") overrides.graphSnapshot = null;
    if (bad === "ambiguous") pipeline.push({ ...pipeline[0]! });
    if (bad === "non-head")
      pipeline.unshift({ nodeId: "pay", templateKind: "PAYER", contractAddress: PAYER });
    if (bad === "wrong-network") overrides.network = "mainnet";
    if (bad === "bad-address") pipeline[0]!.contractAddress = "invalid";
    if (bad === "multiple-triggers")
      overrides.graphSnapshot = {
        ...recorded,
        nodes: [...recorded.nodes, { ...recorded.nodes[0], id: "second" }],
      };
    authorize({ pipelineSnapshot: pipeline, ...overrides });
    expect((await call()).status).toBe(422);
    expect(mocks.subscriber).not.toHaveBeenCalled();
  });
  it.each(["invalid", "revoked", "wrong-deployment", "RETIRING", "RETIRED"])(
    "refuses %s tokens/service before live reads",
    async (bad) => {
      const row = tokenRow(token, deployment);
      if (bad === "revoked") row.revokedAt = new Date() as never;
      if (bad === "wrong-deployment") row.deploymentId = "22222222-2222-4222-8222-222222222222";
      if (bad === "RETIRING" || bad === "RETIRED") row.deployment.serviceState = bad;
      mocks.db.deploymentApiToken.findUnique.mockResolvedValue(row);
      expect((await call(bad === "invalid" ? "Bearer invalid" : undefined)).status).toBe(401);
      expect(mocks.subscriber).not.toHaveBeenCalled();
    },
  );
  it("honors service retirement after authentication", async () => {
    mocks.service.mockRejectedValue(new AppError("NOT_FOUND", "Deployment not found"));
    expect((await call()).status).toBe(404);
    expect(mocks.subscriber).not.toHaveBeenCalled();
  });
  it("bounds live polls per token", async () => {
    for (let i = 0; i < V1_RATE_LIMITS.subscriptionState.limit; i++)
      expect((await call()).status).toBe(200);
    const reads = mocks.subscriber.mock.calls.length;
    expect((await call()).status).toBe(429);
    expect(mocks.subscriber).toHaveBeenCalledTimes(reads);
  });
});

describe("Subscription state response schema", () => {
  it.each([
    { allowance: "1.2" },
    { allowance: "-1" },
    { allowance: (1n << 127n).toString() },
    { subscriber: "invalid" },
    { tokenContractAddress: subscriber },
    { templateKind: "PAYROLL" },
    { privateKey: "unexpected private configuration" },
  ])("rejects malformed response fields %j", async (bad) => {
    const response = await call();
    const data = (await response.json()).data;
    expect(SubscriptionStateSchema.safeParse({ ...data, ...bad }).success).toBe(false);
  });
});
