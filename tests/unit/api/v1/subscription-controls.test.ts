import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { Account, Contract, Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
const mocks = vi.hoisted(() => ({
  db: {
    deploymentApiToken: { findUnique: vi.fn(), update: vi.fn() },
    deployment: { findFirst: vi.fn() },
  },
  subscriber: vi.fn(),
  asset: vi.fn(),
  cancelled: vi.fn(),
  service: vi.fn(),
  latest: vi.fn(),
  cancelBuilder: vi.fn(),
  reactivateBuilder: vi.fn(),
  create: vi.fn(),
  read: vi.fn(),
  reconcile: vi.fn(),
  submit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/deployments/service-work", () => ({
  withDeploymentWork: async (_id: string, _kind: string, fn: () => Promise<unknown>) => {
    await mocks.service();
    return fn();
  },
}));
vi.mock("@/lib/stellar/relayer", () => ({
  readSubscriptionSubscriberNullable: mocks.subscriber,
  readSubscriptionAsset: mocks.asset,
  readSubscriptionIsCancelled: mocks.cancelled,
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => ({ getLatestLedger: mocks.latest }) }));
vi.mock("@/lib/stellar/invoke", () => ({
  prepareSubscriptionUnsubscribeInvocation: mocks.cancelBuilder,
  prepareSubscriptionSubscribeInvocation: mocks.reactivateBuilder,
}));
vi.mock("@/lib/api/v1/control-intent", async (original) => ({
  ...(await original<object>()),
  createControlIntent: mocks.create,
  readControlIntent: mocks.read,
  reconcileControlIntent: mocks.reconcile,
}));
vi.mock("@/lib/api/v1/control-submission", () => ({ submitControlIntent: mocks.submit }));
import { POST as prepareCancel } from "@/app/api/v1/deployments/[id]/subscription/cancel/prepare/route";
import { POST as prepareReactivate } from "@/app/api/v1/deployments/[id]/subscription/reactivate/prepare/route";
import { POST as submitCancel } from "@/app/api/v1/deployments/[id]/subscription/cancel/submit/route";
import { POST as submitReactivate } from "@/app/api/v1/deployments/[id]/subscription/reactivate/submit/route";
import { POST as reconcileCancel } from "@/app/api/v1/deployments/[id]/subscription/cancel/reconcile/route";
import { POST as reconcileReactivate } from "@/app/api/v1/deployments/[id]/subscription/reactivate/reconcile/route";
import { verifyControlTransaction } from "@/lib/api/v1/control-intent";
import {
  SubscriptionControlPreparedSchema,
  SubscriptionControlReconciledSchema,
  SubscriptionControlPrepareSchema,
  SubscriptionControlReconcileSchema,
} from "@/lib/api/v1/schema";
import { deploymentCapabilities } from "@/lib/api/v1/capabilities";
import { AppError } from "@/lib/errors";
import { assetContractId } from "@/lib/stellar/assets";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { ctx, DEPLOYMENT_ID, newToken, tokenRow, TRIGGER, PAYER } from "./execute-fixtures";
const wallet = Keypair.random();
const other = Keypair.random();
const intentId = "11111111-1111-4111-8111-111111111111";
let token: ReturnType<typeof newToken>;
let deployment: Parameters<typeof deploymentCapabilities>[0] & {
  ownerId: string;
  serviceState: string;
  flow: { name: string; templateKind: string };
};
function authorize(kind = "SUBSCRIPTION") {
  deployment = {
    id: DEPLOYMENT_ID,
    status: "CONFIRMED",
    network: "testnet",
    webhookSecret: null,
    ownerId: DEPLOYMENT_ID,
    serviceState: "ACTIVE",
    flow: { name: "Club", templateKind: "SUBSCRIPTION" },
    graphSnapshot: {
      nodes: [
        {
          id: "sub",
          type: "subscription",
          config: {
            subscriber: other.publicKey(),
            asset: { kind: "native" },
            amountPerPeriodStroops: "100",
          },
        },
      ],
      edges: [],
    },
    pipelineSnapshot: [{ nodeId: "sub", templateKind: kind, contractAddress: TRIGGER }],
  };
  mocks.db.deploymentApiToken.findUnique.mockResolvedValue(tokenRow(token, deployment));
  mocks.db.deployment.findFirst.mockResolvedValue(deployment);
}
function call(handler: typeof prepareCancel, body: unknown, auth = `Bearer ${token.plaintext}`) {
  return handler(
    new Request(`https://paiflow.test/api/v1/deployments/${DEPLOYMENT_ID}/subscription/control`, {
      method: "POST",
      headers: { authorization: auth, "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as NextRequest,
    ctx(DEPLOYMENT_ID),
  );
}
function signed(method = "unsubscribe", signer = wallet) {
  const tx = new TransactionBuilder(new Account(wallet.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(new Contract(TRIGGER).call(method))
    .setTimebounds(0, 2_000_000_000)
    .build();
  tx.sign(signer);
  return tx;
}
beforeEach(() => {
  vi.clearAllMocks();
  token = newToken();
  authorize();
  mocks.db.deploymentApiToken.update.mockResolvedValue({});
  mocks.service.mockResolvedValue(undefined);
  mocks.subscriber.mockResolvedValue(wallet.publicKey());
  mocks.asset.mockResolvedValue(assetContractId({ kind: "native" }));
  mocks.cancelled.mockResolvedValue(false);
  mocks.latest.mockResolvedValue({ sequence: 123 });
  mocks.cancelBuilder.mockResolvedValue({ xdr: "simulated" });
  mocks.reactivateBuilder.mockResolvedValue({ xdr: "simulated" });
  mocks.create.mockResolvedValue({
    intent: intentId,
    txHash: "a".repeat(64),
    expiresAt: new Date().toISOString(),
  });
  const tx = signed();
  mocks.read.mockResolvedValue({
    id: intentId,
    deploymentId: DEPLOYMENT_ID,
    network: "testnet",
    action: "subscription.cancel",
    state: "PREPARED",
    walletAddress: wallet.publicKey(),
    nodeId: "sub",
    contractAddress: TRIGGER,
    txHash: tx.hash().toString("hex"),
    maxTime: tx.timeBounds!.maxTime,
  });
  mocks.submit.mockImplementation(async (input) => {
    const binding = await mocks.read();
    verifyControlTransaction(binding, input.signedXdr);
    if (binding.state === "PREPARED") await input.assertEligible();
    return { txHash: binding.txHash, network: "testnet", status: "PENDING" };
  });
  mocks.reconcile.mockResolvedValue({
    id: intentId,
    txHash: "a".repeat(64),
    action: "subscription.cancel",
    state: "PREPARED",
    ledger: null,
  });
});
describe("wallet-authorized subscription controls", () => {
  it.each(["SUBSCRIPTION", "SUBSCRIPTION_DEV"])(
    "prepares %s cancellation for live subscriber, ignoring stale editable/snapshot subscriber",
    async (kind) => {
      authorize(kind);
      deployment.flow.templateKind = "PAYROLL";
      const response = await call(prepareCancel, { walletAddress: wallet.publicKey() });
      expect(response.status).toBe(200);
      expect(SubscriptionControlPreparedSchema.parse((await response.json()).data)).toMatchObject({
        action: "subscription.cancel",
        walletAddress: wallet.publicKey(),
        tokenContractAddress: assetContractId({ kind: "native" }),
        networkPassphrase: Networks.TESTNET,
      });
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeId: "sub",
          action: "subscription.cancel",
          preparationLedger: 123,
          unsignedXdr: "simulated",
        }),
      );
      expect(mocks.cancelBuilder).toHaveBeenCalledWith({
        contractAddress: TRIGGER,
        subscriberAddress: wallet.publicKey(),
      });
      expect(mocks.reactivateBuilder).not.toHaveBeenCalled();
    },
  );
  it("reactivates only cancelled state without allowance or billing changes", async () => {
    mocks.cancelled.mockResolvedValue(true);
    expect((await call(prepareReactivate, { walletAddress: wallet.publicKey() })).status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "subscription.reactivate" }),
    );
    expect(mocks.reactivateBuilder).toHaveBeenCalledOnce();
    expect(mocks.cancelBuilder).not.toHaveBeenCalled();
  });
  it.each([prepareCancel, prepareReactivate])(
    "rejects wrong subscriber and unconfigured subscriber",
    async (handler) => {
      expect((await call(handler, { walletAddress: other.publicKey() })).status).toBe(403);
      mocks.subscriber.mockResolvedValue(null);
      expect((await call(handler, { walletAddress: wallet.publicKey() })).status).toBe(422);
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  it("rejects cancellation on cancelled state and reactivation on active state", async () => {
    expect((await call(prepareReactivate, { walletAddress: wallet.publicKey() })).status).toBe(409);
    mocks.cancelled.mockResolvedValue(true);
    expect((await call(prepareCancel, { walletAddress: wallet.publicKey() })).status).toBe(409);
  });
  it.each(["PAYROLL", "STREAMER", "SUBSCRIPTION_OTHER"])(
    "rejects unsupported %s before simulation",
    async (kind) => {
      authorize(kind);
      expect((await call(prepareCancel, { walletAddress: wallet.publicKey() })).status).toBe(422);
      expect(mocks.cancelBuilder).not.toHaveBeenCalled();
    },
  );
  it("preserves existing Dev cancellation with Dev disabled while gating Dev reactivation", async () => {
    vi.stubEnv("FEATURE_DEV_MODE_ENABLED", "false");
    vi.resetModules();
    try {
      const { POST: prepare } =
        await import("@/app/api/v1/deployments/[id]/subscription/cancel/prepare/route");
      const { POST: submit } =
        await import("@/app/api/v1/deployments/[id]/subscription/cancel/submit/route");
      const { POST: reactivate } =
        await import("@/app/api/v1/deployments/[id]/subscription/reactivate/prepare/route");
      const { deploymentCapabilities: capabilities } = await import("@/lib/api/v1/capabilities");
      authorize("SUBSCRIPTION_DEV");
      expect(capabilities(deployment).operations.subscriptionCancel.status).toBe("conditional");
      expect(capabilities(deployment).operations.subscriptionReactivate.status).toBe("unsupported");
      expect((await call(prepare, { walletAddress: wallet.publicKey() })).status).toBe(200);
      expect((await call(submit, { intent: intentId, signedXdr: signed().toXDR() })).status).toBe(
        200,
      );
      expect((await call(prepare, { walletAddress: other.publicKey() })).status).toBe(403);
      mocks.cancelled.mockResolvedValue(true);
      expect((await call(reactivate, { walletAddress: wallet.publicKey() })).status).toBe(422);
      authorize();
      expect((await call(reactivate, { walletAddress: wallet.publicKey() })).status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
  it("keeps an unresolved intent conflict rather than silently preparing a replacement", async () => {
    mocks.create.mockRejectedValue(
      new AppError("CONFLICT", "A previous control requires finality reconciliation", {
        intent: [intentId],
        txHash: ["a".repeat(64)],
      }),
    );
    const response = await call(prepareCancel, { walletAddress: wallet.publicKey() });
    expect(response.status).toBe(409);
    expect((await response.json()).error.fields.intent).toEqual([intentId]);
  });
  it("rejects token or subscriber changes during simulation before reserving an intent", async () => {
    mocks.asset
      .mockResolvedValueOnce(assetContractId({ kind: "native" }))
      .mockResolvedValueOnce(PAYER);
    expect((await call(prepareCancel, { walletAddress: wallet.publicKey() })).status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.subscriber
      .mockResolvedValueOnce(wallet.publicKey())
      .mockResolvedValueOnce(other.publicKey());
    expect((await call(prepareCancel, { walletAddress: wallet.publicKey() })).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("refuses unavailable preparation ledger and unsuccessful simulation without reserving an intent", async () => {
    mocks.latest.mockRejectedValueOnce(new Error("Transport failed"));
    expect((await call(prepareCancel, { walletAddress: wallet.publicKey() })).status).toBe(502);
    mocks.cancelBuilder.mockRejectedValueOnce(
      new AppError("VALIDATION", "Unsupported contract method or authorization"),
    );
    expect((await call(prepareCancel, { walletAddress: wallet.publicKey() })).status).toBe(422);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("propagates live state failures without constructing an intent", async () => {
    mocks.asset.mockRejectedValue(new AppError("UPSTREAM_RPC", "Configuration unavailable"));
    expect((await call(prepareCancel, { walletAddress: wallet.publicKey() })).status).toBe(502);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([{}, { walletAddress: "invalid" }, { walletAddress: wallet.publicKey(), amount: "1" }])(
    "strictly rejects invalid preparation body %j",
    async (body) => {
      expect((await call(prepareCancel, body)).status).toBe(422);
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  it.each(["missing", "revoked", "wrong-deployment", "RETIRING", "RETIRED"])(
    "rejects %s authorization before signing work",
    async (bad) => {
      const row = tokenRow(token, deployment);
      if (bad === "revoked") row.revokedAt = new Date() as never;
      if (bad === "wrong-deployment") row.deploymentId = intentId;
      if (bad === "RETIRING" || bad === "RETIRED") row.deployment.serviceState = bad;
      mocks.db.deploymentApiToken.findUnique.mockResolvedValue(row);
      expect(
        (
          await call(
            prepareCancel,
            { walletAddress: wallet.publicKey() },
            bad === "missing" ? "" : undefined,
          )
        ).status,
      ).toBe(401);
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  it("honors retirement after token lookup", async () => {
    mocks.service.mockRejectedValue(new AppError("NOT_FOUND", "Service closed"));
    expect((await call(prepareCancel, { walletAddress: wallet.publicKey() })).status).toBe(404);
  });
  it("advertises conditional subscriber wallet controls without disclosing subscriber or billing configuration", () => {
    const capabilities = deploymentCapabilities(deployment);
    expect(capabilities.operations.subscriptionCancel).toMatchObject({
      status: "conditional",
      authentication: "subscriber_wallet",
      nodeIds: ["sub"],
    });
    expect(capabilities.operations.subscriptionReactivate.status).toBe("conditional");
    expect(JSON.stringify(capabilities)).not.toContain(wallet.publicKey());
    expect(JSON.stringify(capabilities)).not.toContain(other.publicKey());
  });
  it.each([
    {},
    { intent: "invalid", signedXdr: "x" },
    { intent: intentId, signedXdr: "x", walletAddress: wallet.publicKey() },
  ])("rejects malformed submit body %j", async (body) => {
    expect((await call(submitCancel, body)).status).toBe(422);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("does not permit recovery for an intent belonging to a different action/deployment", async () => {
    mocks.reconcile.mockRejectedValue(
      new AppError("NOT_FOUND", "Wallet-control preparation not found"),
    );
    expect((await call(reconcileReactivate, { intent: intentId })).status).toBe(404);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("requires actual subscriber signature and exact action envelope", async () => {
    const tx = signed();
    expect((await call(submitCancel, { intent: intentId, signedXdr: tx.toXDR() })).status).toBe(
      200,
    );
    expect(
      (
        await call(submitCancel, {
          intent: intentId,
          signedXdr: signed("unsubscribe", other).toXDR(),
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(submitCancel, { intent: intentId, signedXdr: signed("subscribe").toXDR() }))
        .status,
    ).toBe(422);
  });
  it("checks latest subscriber, state and selected target on the first send", async () => {
    mocks.subscriber.mockResolvedValue(other.publicKey());
    expect(
      (await call(submitCancel, { intent: intentId, signedXdr: signed().toXDR() })).status,
    ).toBe(403);
    mocks.subscriber.mockResolvedValue(wallet.publicKey());
    mocks.cancelled.mockResolvedValue(true);
    expect(
      (await call(submitCancel, { intent: intentId, signedXdr: signed().toXDR() })).status,
    ).toBe(409);
  });
  it("delegates valid reactivation submission to the shared durable protocol", async () => {
    const tx = signed("subscribe");
    const binding = await mocks.read();
    mocks.read.mockResolvedValue({
      ...binding,
      action: "subscription.reactivate",
      txHash: tx.hash().toString("hex"),
      maxTime: tx.timeBounds!.maxTime,
    });
    mocks.cancelled.mockResolvedValue(true);
    expect((await call(submitReactivate, { intent: intentId, signedXdr: tx.toXDR() })).status).toBe(
      200,
    );
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "subscription.reactivate",
        tokenId: expect.any(String),
        assertEligible: expect.any(Function),
      }),
    );
  });
  it("does not reject already claimed retry because successful cancellation changed state", async () => {
    const binding = await mocks.read();
    mocks.read.mockResolvedValue({ ...binding, state: "SUBMITTING" });
    mocks.cancelled.mockResolvedValue(true);
    expect(
      (await call(submitCancel, { intent: intentId, signedXdr: signed().toXDR() })).status,
    ).toBe(200);
    expect(mocks.subscriber).not.toHaveBeenCalled();
  });
  it.each([reconcileCancel, reconcileReactivate])(
    "offers explicit recovery scoped to deployment and action",
    async (handler) => {
      expect((await call(handler, { intent: intentId })).status).toBe(200);
      expect(mocks.reconcile).toHaveBeenCalledWith(
        intentId,
        DEPLOYMENT_ID,
        handler === reconcileCancel ? "subscription.cancel" : "subscription.reactivate",
      );
      expect(mocks.cancelBuilder).not.toHaveBeenCalled();
    },
  );
  it.each(["PREPARED", "SUBMITTING", "SUCCESS", "FAILED", "EXPIRED"])(
    "reports replacement eligibility honestly for %s",
    async (state) => {
      const current = await mocks.reconcile();
      mocks.reconcile.mockResolvedValue({ ...current, state });
      const data = SubscriptionControlReconciledSchema.parse(
        (await (await call(reconcileCancel, { intent: intentId })).json()).data,
      );
      expect(data.replacementAllowed).toBe(["SUCCESS", "FAILED", "EXPIRED"].includes(state));
    },
  );
  it("rate limits preparation before constructing another intent", async () => {
    for (let i = 0; i < V1_RATE_LIMITS.subscriptionControlPrepare.limit; i++)
      expect((await call(prepareCancel, { walletAddress: wallet.publicKey() })).status).toBe(200);
    expect((await call(prepareCancel, { walletAddress: wallet.publicKey() })).status).toBe(429);
  });
});
describe("request schemas", () => {
  it("accepts a Stellar wallet and UUID without unknown fields", () => {
    expect(SubscriptionControlPrepareSchema.parse({ walletAddress: wallet.publicKey() })).toEqual({
      walletAddress: wallet.publicKey(),
    });
    expect(SubscriptionControlPrepareSchema.safeParse({ walletAddress: TRIGGER }).success).toBe(
      false,
    );
    expect(SubscriptionControlReconcileSchema.safeParse({ intent: "invalid" }).success).toBe(false);
    expect(
      SubscriptionControlReconcileSchema.safeParse({ intent: intentId, signedXdr: "ignored" })
        .success,
    ).toBe(false);
  });
});
