import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { Keypair } from "@stellar/stellar-sdk";

const { mockDb, mockRpc } = vi.hoisted(() => ({
  mockDb: { deploymentApiToken: { findUnique: vi.fn(), update: vi.fn() } },
  mockRpc: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: mockRpc }));

import { GET } from "@/app/api/v1/deployments/[id]/capabilities/route";
import { DeploymentCapabilitiesSchema } from "@/lib/api/v1/schema";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { ctx, DEPLOYMENT_ID, newToken, PAYER, tokenRow, TRIGGER } from "./execute-fixtures";

const PATH = `/api/v1/deployments/${DEPLOYMENT_ID}/capabilities`;
const ACCOUNT = Keypair.random().publicKey();
const trigger = { id: "trigger", type: "on_receive", config: { asset: { kind: "native" } } };
const pay = {
  id: "pay",
  type: "pay",
  config: { recipient: ACCOUNT, asset: { kind: "native" }, fullAmount: true },
};
const graph = { nodes: [trigger, pay], edges: [{ id: "edge", source: "trigger", target: "pay" }] };
const pipeline = [
  { nodeId: "trigger", templateKind: "DEPOSIT_TRIGGER", contractAddress: TRIGGER },
  { nodeId: "pay", templateKind: "PAYER", contractAddress: PAYER },
];
let token: ReturnType<typeof newToken>;

function authorize(overrides: Record<string, unknown> = {}) {
  mockDb.deploymentApiToken.findUnique.mockResolvedValue(
    tokenRow(token, {
      network: "testnet",
      graphSnapshot: graph,
      pipelineSnapshot: pipeline,
      webhookSecret: null,
      ...overrides,
    }),
  );
}

function call(authorization = `Bearer ${token.plaintext}`, id = DEPLOYMENT_ID) {
  return GET(
    new Request(`https://paiflow.test${PATH}`, {
      headers: { authorization, "x-request-id": "capabilities-test" },
    }) as NextRequest,
    ctx(id),
  );
}

async function data() {
  const response = await call();
  expect(response.status).toBe(200);
  const body = await response.json();
  return DeploymentCapabilitiesSchema.parse(body.data);
}

beforeEach(() => {
  vi.clearAllMocks();
  token = newToken();
  mockDb.deploymentApiToken.update.mockResolvedValue({});
  authorize();
});

describe("deployment capabilities", () => {
  it("supports standard deposit execution and monitoring without offering mutable recipients", async () => {
    const result = await data();
    expect(result.network).toBe("testnet");
    expect(result.triggerType).toBe("deposit");
    expect(result.inputAsset).toEqual({ kind: "native" });
    expect(result.configurationSource).toBe("deployment_snapshot");
    expect(result.operations.execute.status).toBe("supported");
    expect(result.operations.events.status).toBe("supported");
    expect(result.operations.transactions.status).toBe("supported");
    expect(result.operations.payouts.status).toBe("unsupported");
    expect(result.operations.execute.requirements.join(" ")).toContain("sign");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("does not use an editable-looking graph to turn a webhook into a deposit flow", async () => {
    authorize({
      pipelineSnapshot: [{ ...pipeline[0], templateKind: "WEBHOOK" }],
      webhookSecret: "synthetic-webhook-secret",
    });
    const result = await data();
    expect(result.triggerType).toBe("webhook");
    expect(result.operations.execute.status).toBe("unsupported");
    expect(result.operations.webhook.status).toBe("supported");
    expect(result.operations.webhook.authentication).toBe("webhook_secret");
    expect(result.operations.webhook.requirements.join(" ")).toContain("Idempotency-Key");
    expect(JSON.stringify(result)).not.toContain("synthetic-webhook-secret");
  });

  it("does not advertise an HTTP callback without its enabled secret", async () => {
    authorize({ pipelineSnapshot: [{ ...pipeline[0], templateKind: "WEBHOOK" }] });
    expect((await data()).operations.webhook.status).toBe("unsupported");
  });

  it("lists early-release branches but excludes strict Hold contracts", async () => {
    authorize({
      pipelineSnapshot: [
        ...pipeline,
        { nodeId: "early", templateKind: "TIMELOCK_BRANCH", contractAddress: PAYER },
        { nodeId: "hold", templateKind: "TIMELOCK", contractAddress: TRIGGER },
      ],
    });
    const result = await data();
    expect(result.operations.releaseEarly.status).toBe("supported");
    expect(result.operations.releaseEarly.nodeIds).toEqual(["early"]);
    expect(result.operations.releaseEarly.requirements.join(" ")).toContain("deadline");
    authorize({ pipelineSnapshot: [{ ...pipeline[0], templateKind: "TIMELOCK" }] });
    expect((await data()).operations.releaseEarly.status).toBe("unsupported");
  });

  it("marks Dev payout candidates conditional rather than asserting live eligibility", async () => {
    authorize({
      graphSnapshot: { ...graph, devMode: true },
      pipelineSnapshot: [pipeline[0], { ...pipeline[1], templateKind: "PAYER_DEV" }],
    });
    const result = await data();
    expect(result.operations.payouts.status).toBe("conditional");
    expect(result.operations.payouts.nodeIds).toEqual(["pay"]);
    expect(result.operations.payouts.requirements.join(" ")).toContain("current on-chain");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("excludes fiat Pay and non-Dev configurations from payout candidates", async () => {
    const mutablePipeline = [pipeline[0], { ...pipeline[1], templateKind: "PAYER_DEV" }];
    authorize({ pipelineSnapshot: mutablePipeline });
    expect((await data()).operations.payouts.status).toBe("unsupported");
    authorize({
      graphSnapshot: {
        ...graph,
        devMode: true,
        nodes: [trigger, { ...pay, config: { ...pay.config, payoutMode: "fiat" } }],
      },
      pipelineSnapshot: mutablePipeline,
    });
    expect((await data()).operations.payouts.status).toBe("unsupported");
  });

  it("does not advertise payouts through delayed conditions or a swap", async () => {
    for (const kind of ["TIMELOCK_BRANCH", "SWAPPER"]) {
      const middle =
        kind === "TIMELOCK_BRANCH"
          ? {
              id: "middle",
              type: "condition",
              config: { kind: "time_before", at: "2030-01-01T00:00:00Z" },
            }
          : {
              id: "middle",
              type: "swap",
              config: { assetIn: { kind: "native" }, assetOut: { kind: "known", symbol: "USDC" } },
            };
      authorize({
        graphSnapshot: {
          devMode: true,
          nodes: [trigger, middle, pay],
          edges: [
            { id: "a", source: "trigger", target: "middle" },
            { id: "b", source: "middle", target: "pay" },
          ],
        },
        pipelineSnapshot: [
          pipeline[0],
          { nodeId: "middle", templateKind: kind, contractAddress: PAYER },
          { ...pipeline[1], templateKind: "PAYER_DEV" },
        ],
      });
      expect((await data()).operations.payouts.status).toBe("unsupported");
    }
  });

  it("discovers both single-destination amount branches as conditional candidates", async () => {
    const middle = {
      id: "middle",
      type: "condition",
      config: { kind: "amount_gt", amountStroops: "10000000" },
    };
    const other = { ...pay, id: "other" };
    authorize({
      graphSnapshot: {
        devMode: true,
        nodes: [trigger, middle, pay, other],
        edges: [
          { id: "a", source: "trigger", target: "middle" },
          { id: "b", source: "middle", target: "pay", sourceHandle: "true" },
          { id: "c", source: "middle", target: "other", sourceHandle: "false" },
        ],
      },
      pipelineSnapshot: [
        pipeline[0],
        { nodeId: "middle", templateKind: "ROUTER", contractAddress: PAYER },
        { ...pipeline[1], templateKind: "PAYER_DEV" },
        { nodeId: "other", templateKind: "PAYER_DEV", contractAddress: TRIGGER },
      ],
    });
    expect((await data()).operations.payouts.nodeIds).toEqual(["pay", "other"]);
  });

  it.each(["SUBSCRIPTION", "SUBSCRIPTION_DEV"])(
    "discovers %s wallet approval without implying any wallet can subscribe",
    async (kind) => {
      const subscription = {
        id: "trigger",
        type: "subscription",
        config: {
          asset: { kind: "known", symbol: "USDC" },
          subscriber: ACCOUNT,
          amountPerPeriodStroops: "10000000",
        },
      };
      authorize({
        graphSnapshot: { ...graph, nodes: [subscription, pay] },
        pipelineSnapshot: [{ ...pipeline[0], templateKind: kind }, pipeline[1]],
      });
      const result = await data();
      expect(result.triggerType).toBe("subscription");
      expect(result.inputAsset).toEqual({ kind: "known", symbol: "USDC" });
      expect(result.operations.execute.status).toBe("unsupported");
      expect(result.operations.subscriptionAllowance.status).toBe("conditional");
      expect(result.operations.subscriptionAllowance.authentication).toBe("subscriber_wallet");
      expect(result.operations.subscriptionAllowance.requirements.join(" ")).toContain(
        "configured subscriber",
      );
      expect(JSON.stringify(result)).not.toContain(ACCOUNT);
    },
  );

  it("does not mistake decomposed payroll for public subscription approval", async () => {
    authorize({
      graphSnapshot: {
        ...graph,
        nodes: [
          {
            id: "trigger",
            type: "payroll",
            config: { asset: { kind: "native" }, employer: ACCOUNT },
          },
          pay,
        ],
      },
      pipelineSnapshot: [{ ...pipeline[0], templateKind: "SUBSCRIPTION" }, pipeline[1]],
    });
    const result = await data();
    expect(result.triggerType).toBe("payroll");
    expect(result.operations.subscriptionAllowance.status).toBe("unsupported");
  });

  it.each(["STREAMER", "ORACLE"])("does not offer execute for %s", async (kind) => {
    authorize({ pipelineSnapshot: [{ ...pipeline[0], templateKind: kind }] });
    expect((await data()).operations.execute.status).toBe("unsupported");
  });

  it.each([null, [], [null], [{ ...pipeline[0], contractAddress: "invalid" }]])(
    "handles malformed pipeline metadata conservatively: %j",
    async (snapshot) => {
      authorize({ pipelineSnapshot: snapshot });
      const result = await data();
      expect(result.triggerType).toBe("unknown");
      expect(result.operations.execute.status).toBe("unsupported");
      expect(result.operations.events.status).toBe("supported");
    },
  );

  it("keeps monitoring and pipeline-based execution when graph metadata is unavailable", async () => {
    authorize({ graphSnapshot: { nodes: "malformed" } });
    const result = await data();
    expect(result.operations.execute.status).toBe("supported");
    expect(result.inputAsset).toBeNull();
    expect(result.operations.payouts.status).toBe("unsupported");
  });

  it("projects only asset identity and excludes credentials and private configuration", async () => {
    authorize({
      webhookSecret: "private-webhook-value",
      ownerId: "private-owner-value",
      graphSnapshot: {
        ...graph,
        privateMetadata: "private-graph-value",
        notify: { mode: "every_transaction", sendTo: "private-owner@example.test" },
        nodes: [
          trigger,
          {
            ...pay,
            config: {
              ...pay.config,
              email: "private-recipient@example.test",
              accountNumber: "private-bank-value",
            },
          },
        ],
      },
    });
    const response = await call();
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(text).data.inputAsset).toEqual({ kind: "native" });
    for (const value of [
      "private-webhook-value",
      "private-owner-value",
      "private-graph-value",
      "private-owner@example.test",
      "private-recipient@example.test",
      "private-bank-value",
      ACCOUNT,
      token.plaintext,
    ])
      expect(text).not.toContain(value);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("capabilities-test");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns custom asset identity without recipient details", async () => {
    const asset = { kind: "custom", code: "TEST", issuer: ACCOUNT };
    authorize({ graphSnapshot: { ...graph, nodes: [{ ...trigger, config: { asset } }, pay] } });
    expect((await data()).inputAsset).toEqual(asset);
  });
});

describe("capabilities access boundaries", () => {
  it.each(["", "Bearer pkdev_example"])(
    "refuses non-deployment credentials before database access: %s",
    async (auth) => {
      expect((await call(auth)).status).toBe(401);
      expect(mockDb.deploymentApiToken.findUnique).not.toHaveBeenCalled();
    },
  );

  it.each(["unknown", "revoked", "expired", "wrong-deployment", "inactive-owner"])(
    "refuses %s tokens with the generic error",
    async (kind) => {
      const row = {
        ...tokenRow(token),
        revokedAt: null as Date | null,
        expiresAt: null as Date | null,
      };
      if (kind === "revoked") row.revokedAt = new Date();
      if (kind === "expired") row.expiresAt = new Date(0);
      if (kind === "wrong-deployment") row.deploymentId = "22222222-2222-2222-2222-222222222222";
      if (kind === "inactive-owner") row.deployment.owner.isActive = false;
      mockDb.deploymentApiToken.findUnique.mockResolvedValue(kind === "unknown" ? null : row);
      const response = await call();
      expect(response.status).toBe(401);
      expect((await response.json()).error.message).toBe(
        "A valid API token for this deployment is required",
      );
    },
  );

  it("rejects sandbox-owned tokens", async () => {
    mockDb.deploymentApiToken.findUnique.mockResolvedValue(
      tokenRow(token, {}, { isActive: true, role: "SANDBOX" }),
    );
    expect((await call()).status).toBe(403);
  });

  it("rejects malformed deployment IDs before database access", async () => {
    expect((await call(undefined, "invalid")).status).toBe(404);
    expect(mockDb.deploymentApiToken.findUnique).not.toHaveBeenCalled();
  });

  it("requires a confirmed deployment on the current network", async () => {
    authorize({ status: "PENDING" });
    expect((await call()).status).toBe(404);
    authorize({ network: "mainnet" });
    expect((await call()).status).toBe(422);
  });

  it("limits discovery per token and endpoint", async () => {
    for (let i = 0; i < V1_RATE_LIMITS.capabilities.limit; i++)
      expect((await call()).status).toBe(200);
    const response = await call();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).not.toBeNull();
  });
});
