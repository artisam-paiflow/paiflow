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
