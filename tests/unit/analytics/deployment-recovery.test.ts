import { randomUUID } from "node:crypto";
import {
  Account,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

const { rpc, session } = vi.hoisted(() => ({
  rpc: { sendTransaction: vi.fn(), getTransaction: vi.fn() },
  session: { id: "", username: "recovery-admin", role: "ADMIN" },
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => rpc }));
vi.mock("@/lib/auth", () => ({ requireSession: async () => session }));
vi.mock("@/lib/api/write-rate-limit", () => ({ enforceWriteRateLimit: vi.fn() }));
vi.mock("@/lib/redis", () => ({ redis: () => null, eventChannel: (id: string) => `events:${id}` }));

let flowId: string;
let deploymentId: string;
let signedXdr: string;
let txHash: string;
const pipeline = [
  {
    nodeId: "trigger",
    templateKind: "WEBHOOK_TRIGGER",
    contractAddress: StrKey.encodeContract(Buffer.alloc(32, 17)),
  },
  {
    nodeId: "pay",
    templateKind: "PAYER",
    contractAddress: StrKey.encodeContract(Buffer.alloc(32, 18)),
  },
];

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  rpc.sendTransaction.mockReset();
  rpc.getTransaction.mockReset();
  session.id = randomUUID();
  session.role = "ADMIN";
  flowId = randomUUID();
  deploymentId = randomUUID();
  process.env.STELLAR_NETWORK = "testnet";
  process.env.STELLAR_DEPLOY_RECONCILIATION_REHEARSAL_FLOW_ID = flowId;
  process.env.STELLAR_DEPLOY_RECONCILIATION_REHEARSAL_UNTIL = new Date(
    Date.now() + 30 * 60_000,
  ).toISOString();
  const signer = Keypair.random();
  const envelope = new TransactionBuilder(new Account(signer.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: "2" }))
    .setTimeout(180)
    .build();
  envelope.sign(signer);
  signedXdr = envelope.toXDR();
  txHash = envelope.hash().toString("hex");
  const graph = {
    nodes: [
      { id: "trigger", type: "web2_webhook", config: { asset: { kind: "native" } } },
      {
        id: "pay",
        type: "pay",
        config: { asset: { kind: "native" }, recipient: signer.publicKey(), fullAmount: true },
      },
    ],
    edges: [{ id: "tp", source: "trigger", target: "pay" }],
    notify: { mode: "off", sendTo: "" },
  };
  await db.user.create({
    data: {
      id: session.id,
      username: `recovery-${session.id}`,
      passwordHash: "test-only",
      role: "ADMIN",
      analyticsAudience: "INTERNAL",
    },
  });
  await db.flow.create({
    data: {
      id: flowId,
      ownerId: session.id,
      name: "Synthetic webhook recovery",
      templateKind: "SPLITTER",
      graph,
      parameters: [],
    },
  });
  await db.deployment.create({
    data: {
      id: deploymentId,
      flowId,
      ownerId: session.id,
      network: "testnet",
      status: "PENDING_SIGNATURE",
      unsignedXdr: signedXdr,
      graphSnapshot: graph,
      paramsSnapshot: [],
      pipelineSnapshot: pipeline,
    },
  });
  rpc.sendTransaction.mockResolvedValue({ status: "PENDING", hash: txHash });
});
afterEach(async () => {
  vi.useRealTimers();
  delete process.env.STELLAR_DEPLOY_RECONCILIATION_REHEARSAL_FLOW_ID;
  delete process.env.STELLAR_DEPLOY_RECONCILIATION_REHEARSAL_UNTIL;
  delete process.env.STELLAR_NETWORK;
  await db.analyticsDelivery.deleteMany({ where: { distinctId: session.id } });
  await db.signedTransaction.deleteMany({ where: { deploymentId } });
  await db.auditLog.deleteMany({ where: { userId: session.id } });
  await db.deployment.deleteMany({ where: { id: deploymentId } });
  await db.flow.deleteMany({ where: { id: flowId } });
  await db.user.deleteMany({ where: { id: session.id } });
  vi.resetModules();
});
function request(): NextRequest {
  return new Request(`https://paiflow.test/api/deployments/${deploymentId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signedXdr }),
  }) as NextRequest;
}
const context = () => ({ params: Promise.resolve({ id: deploymentId }) });

it("reconciles a delayed original deployment on minute ticks after reload and replay", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const started = Date.now();
  vi.setSystemTime(started);
  const { POST } = await import("@/app/api/deployments/[id]/submit/route");
  const { GET } = await import("@/app/api/deployments/[id]/status/route");
  const { reconcileTransactions } = await import("@/lib/stellar/reconcile-transactions");
  expect((await POST(request(), context())).status).toBe(200);

  // Providers can accept an envelope before their finality reads catch up.
  // Advance only the clock: never force a persisted nextCheckAt into the past.
  rpc.getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
  for (let tick = 1; tick <= 4; tick++) {
    vi.setSystemTime(started + tick * 60_000);
    expect(await reconcileTransactions()).toMatchObject({ checked: 1, confirmed: 0 });
    const pending = await db.signedTransaction.findUniqueOrThrow({ where: { txHash } });
    expect(pending).toMatchObject({
      outcome: "UNRESOLVED",
      checkAttempts: tick,
    });
    expect(pending.nextCheckAt!.getTime()).toBeGreaterThan(Date.now());
    expect(pending.nextCheckAt!.getTime()).toBeLessThanOrEqual(started + (tick + 1) * 60_000);
  }

  const readStatus = () =>
    GET(
      new Request(`https://paiflow.test/api/deployments/${deploymentId}/status`) as NextRequest,
      context(),
    );
  expect(await (await readStatus()).json()).toEqual({ status: "SUBMITTED" });
  expect((await (await POST(request(), context())).json()).data).toEqual({
    status: "SUBMITTED",
    txHash,
  });
  expect(rpc.sendTransaction).toHaveBeenCalledOnce();

  rpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 123 });
  vi.setSystemTime(started + 5 * 60_000);
  expect(await reconcileTransactions()).toMatchObject({ checked: 1, confirmed: 1 });
  expect(await (await readStatus()).json()).toEqual({ status: "CONFIRMED" });
  const confirmed = await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } });
  expect(confirmed).toMatchObject({
    deployTxHash: txHash,
    pipelineSnapshot: pipeline,
    contractAddress: pipeline[0]!.contractAddress,
    confirmedAt: new Date(started + 5 * 60_000),
  });
  expect(confirmed.webhookSecret).toMatch(/^whsec_[a-f0-9]{64}$/);
  expect((await (await POST(request(), context())).json()).data.status).toBe("CONFIRMED");
  expect(rpc.sendTransaction).toHaveBeenCalledOnce();
  expect(await db.auditLog.count({ where: { userId: session.id, action: "DEPLOY_CONFIRM" } })).toBe(
    1,
  );
  expect(await reconcileTransactions()).toMatchObject({ checked: 0 });
});

it.each([false, true])(
  "cron recovers accepted webhook setup exactly once (transient RPC error: %s)",
  async (readError) => {
    const { POST } = await import("@/app/api/deployments/[id]/submit/route");
    const { reconcileTransactions } = await import("@/lib/stellar/reconcile-transactions");
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ status: "SUBMITTED", txHash });
    expect(rpc.getTransaction).not.toHaveBeenCalled();
    expect(await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } })).toMatchObject({
      status: "SUBMITTED",
      confirmedAt: null,
      webhookSecret: null,
      contractAddress: null,
      pipelineSnapshot: pipeline,
    });
    expect(await db.signedTransaction.findUniqueOrThrow({ where: { txHash } })).toMatchObject({
      outcome: "ACCEPTED",
      checkAttempts: 0,
      outcomeRevision: 1,
      nextCheckAt: expect.any(Date),
    });
    const audit = await db.auditLog.findFirstOrThrow({
      where: { userId: session.id, action: "DEPLOY_SUBMIT" },
    });
    expect(audit.metadata).toMatchObject({ reconciliationRehearsal: true });

    // Only this disposable fixture is made due; live rehearsals wait for the scheduled job.
    await db.signedTransaction.update({ where: { txHash }, data: { nextCheckAt: new Date() } });
    if (readError) {
      rpc.getTransaction.mockRejectedValueOnce(new Error("Synthetic RPC interruption"));
      expect(await reconcileTransactions()).toMatchObject({
        checked: 1,
        confirmed: 0,
        unresolved: 1,
      });
      expect(await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } })).toMatchObject({
        status: "SUBMITTED",
        webhookSecret: null,
      });
      await db.signedTransaction.update({ where: { txHash }, data: { nextCheckAt: new Date() } });
    }
    rpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 123 });
    expect(await reconcileTransactions()).toMatchObject({ checked: 1, confirmed: 1 });
    const confirmed = await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } });
    expect(confirmed).toMatchObject({
      status: "CONFIRMED",
      contractAddress: pipeline[0]!.contractAddress,
      confirmedAt: expect.any(Date),
      pipelineSnapshot: pipeline,
    });
    expect(confirmed.webhookSecret).toMatch(/^whsec_[a-f0-9]{64}$/);
    const outcome = await db.signedTransaction.findUniqueOrThrow({ where: { txHash } });
    expect(outcome).toMatchObject({
      outcome: "CONFIRMED",
      ledger: 123,
      checkAttempts: readError ? 2 : 1,
      outcomeRevision: readError ? 3 : 2,
      nextCheckAt: null,
    });
    expect(await reconcileTransactions()).toMatchObject({ checked: 0, confirmed: 0 });
    const duplicate = await POST(request(), context());
    expect(duplicate.status).toBe(200);
    expect((await duplicate.json()).data.status).toBe("CONFIRMED");
    expect(rpc.sendTransaction).toHaveBeenCalledTimes(1);
    expect(await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } })).toMatchObject({
      webhookSecret: confirmed.webhookSecret,
    });
    expect(
      await db.auditLog.count({ where: { userId: session.id, action: "DEPLOY_CONFIRM" } }),
    ).toBe(1);
    expect(
      await db.analyticsDelivery.count({
        where: { distinctId: session.id, event: "transaction_signed" },
      }),
    ).toBe(1);
    expect(
      await db.analyticsDelivery.count({
        where: {
          distinctId: session.id,
          event: "transaction_outcome",
          properties: { path: ["outcome"], equals: "CONFIRMED" },
        },
      }),
    ).toBe(1);
  },
);

it.each(["send", "confirmation"])(
  "ordinary deployment %s timeout stays pending and recovers exactly once without a second send",
  async (stage) => {
    delete process.env.STELLAR_DEPLOY_RECONCILIATION_REHEARSAL_FLOW_ID;
    delete process.env.STELLAR_DEPLOY_RECONCILIATION_REHEARSAL_UNTIL;
    session.role = "USER";
    if (stage === "send")
      rpc.sendTransaction.mockRejectedValueOnce(new Error("Synthetic acknowledgement timeout"));
    else rpc.getTransaction.mockRejectedValueOnce(new Error("Synthetic finality read timeout"));
    const { POST } = await import("@/app/api/deployments/[id]/submit/route");
    const { reconcileTransactions } = await import("@/lib/stellar/reconcile-transactions");
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ status: "SUBMITTED", txHash });
    expect(await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } })).toMatchObject({
      status: "SUBMITTED",
      deployTxHash: txHash,
      confirmedAt: null,
      webhookSecret: null,
    });
    expect(await db.signedTransaction.findUniqueOrThrow({ where: { txHash } })).toMatchObject({
      outcome: "UNRESOLVED",
      failureCode: "RPC_UNAVAILABLE",
      submissionRevision: 1,
      nextCheckAt: expect.any(Date),
    });
    const retry = await POST(request(), context());
    expect(retry.status).toBe(200);
    expect((await retry.json()).data).toEqual({ status: "SUBMITTED", txHash });
    expect(rpc.sendTransaction).toHaveBeenCalledOnce();
    expect(
      await db.auditLog.count({ where: { userId: session.id, action: "DEPLOY_SUBMIT" } }),
    ).toBe(1);

    await db.signedTransaction.update({ where: { txHash }, data: { nextCheckAt: new Date() } });
    rpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 123 });
    expect(await reconcileTransactions()).toMatchObject({ checked: 1, confirmed: 1 });
    const confirmed = await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } });
    expect(confirmed).toMatchObject({
      status: "CONFIRMED",
      deployTxHash: txHash,
      pipelineSnapshot: pipeline,
    });
    expect(confirmed.webhookSecret).toMatch(/^whsec_[a-f0-9]{64}$/);
    expect(await db.signedTransaction.findUniqueOrThrow({ where: { txHash } })).toMatchObject({
      outcome: "CONFIRMED",
      ledger: 123,
      nextCheckAt: null,
      submissionRevision: 1,
    });
    expect(await reconcileTransactions()).toMatchObject({ checked: 0, confirmed: 0 });
    const duplicate = await POST(request(), context());
    expect((await duplicate.json()).data.status).toBe("CONFIRMED");
    expect(rpc.sendTransaction).toHaveBeenCalledOnce();
    expect(await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } })).toMatchObject({
      webhookSecret: confirmed.webhookSecret,
    });
    expect(
      await db.auditLog.count({ where: { userId: session.id, action: "DEPLOY_CONFIRM" } }),
    ).toBe(1);
    expect(await db.auditLog.count({ where: { userId: session.id, action: "DEPLOY_FAIL" } })).toBe(
      0,
    );
    expect(
      await db.analyticsDelivery.count({
        where: { distinctId: session.id, event: "transaction_signed" },
      }),
    ).toBe(1);
    expect(
      await db.analyticsDelivery.count({
        where: {
          distinctId: session.id,
          event: "transaction_outcome",
          properties: { path: ["outcome"], equals: "CONFIRMED" },
        },
      }),
    ).toBe(1);
  },
);
