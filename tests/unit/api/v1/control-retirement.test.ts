import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  send: vi.fn(),
  latest: vi.fn(),
  ledgers: vi.fn(),
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({
    getTransaction: mocks.get,
    sendTransaction: mocks.send,
    getLatestLedger: mocks.latest,
    getLedgers: mocks.ledgers,
  }),
}));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/stellar/events", () => ({
  pollEventsForWithOutcome: vi.fn(),
  reconcileStoredCashOutObligations: vi.fn(async () => true),
}));
import {
  createControlIntent,
  reconcileControlIntent,
  repairControlAdmission,
} from "@/lib/api/v1/control-intent";
import { submitControlIntent } from "@/lib/api/v1/control-submission";
import { getTransactionStatus } from "@/lib/api/v1/transaction-status";
import { requestRetirement, reconcileRetirement } from "@/lib/deployments/retirement";
import { recordTransactionOutcome } from "@/lib/analytics/outcomes";
const wallet = Keypair.random();
const contract = StrKey.encodeContract(Buffer.alloc(32, 19));
const expiry = Math.floor(Date.now() / 1000) + 180;
let ownerId: string;
let flowId: string;
const deploymentIds: string[] = [];
const tokenIds: string[] = [];
function lookup(close = expiry + 1, oldest = 80) {
  return {
    status: "NOT_FOUND",
    latestLedger: 100,
    oldestLedger: oldest,
    latestLedgerCloseTime: String(close),
    oldestLedgerCloseTime: String(expiry - 100),
  };
}
beforeAll(async () => {
  ownerId = (
    await db.user.create({
      data: { username: `control-retirement-${randomUUID()}`, passwordHash: "test-only" },
    })
  ).id;
  flowId = (
    await db.flow.create({
      data: {
        ownerId,
        name: "control retirement",
        templateKind: "SUBSCRIPTION",
        graph: {},
        parameters: {},
      },
    })
  ).id;
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(lookup());
  mocks.latest.mockResolvedValue({ sequence: 100 });
  mocks.ledgers.mockResolvedValue({
    ledgers: [{ sequence: 100, ledgerCloseTime: String(expiry + 1) }],
  });
  mocks.send.mockResolvedValue({ status: "PENDING" });
});
afterAll(async () => {
  await db.serviceTransaction.deleteMany({
    where: { work: { deploymentId: { in: deploymentIds } } },
  });
  await db.deploymentWork.deleteMany({ where: { deploymentId: { in: deploymentIds } } });
  await db.walletControlIntent.deleteMany({ where: { deploymentId: { in: deploymentIds } } });
  await db.signedTransaction.deleteMany({ where: { deploymentId: { in: deploymentIds } } });
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { userId: ownerId },
        ...deploymentIds.map((id) => ({ metadata: { path: ["deploymentId"], equals: id } })),
      ],
    },
  });
  await db.analyticsDelivery.deleteMany({
    where: { distinctId: { in: tokenIds.map((id) => `api:${id}`) } },
  });
  await db.deployment.deleteMany({ where: { id: { in: deploymentIds } } });
  await db.flow.delete({ where: { id: flowId } });
  await db.user.delete({ where: { id: ownerId } });
});
async function fixture(mode: "accepted" | "unknown" | "rejected" | "prepared" = "accepted") {
  const deployment = await db.deployment.create({
    data: {
      ownerId,
      flowId,
      network: "testnet",
      status: "CONFIRMED",
      graphSnapshot: {},
      paramsSnapshot: {},
      pipelineSnapshot: [
        { nodeId: "subscription", templateKind: "SUBSCRIPTION", contractAddress: contract },
      ],
    },
  });
  deploymentIds.push(deployment.id);
  const token = await db.deploymentApiToken.create({
    data: {
      deploymentId: deployment.id,
      createdById: ownerId,
      tokenHash: randomUUID(),
      tokenPrefix: "test",
    },
  });
  tokenIds.push(token.id);
  const transaction = new TransactionBuilder(
    new Account(wallet.publicKey(), String(deploymentIds.length)),
    { fee: BASE_FEE, networkPassphrase: Networks.TESTNET },
  )
    .addOperation(new Contract(contract).call("unsubscribe"))
    .setTimebounds(0, expiry)
    .build();
  const intent = await createControlIntent({
    deployment,
    nodeId: "subscription",
    action: "subscription.cancel",
    walletAddress: wallet.publicKey(),
    unsignedXdr: transaction.toXDR(),
    preparationLedger: 90,
  });
  if (mode !== "prepared") {
    transaction.sign(wallet);
    if (mode === "unknown") mocks.send.mockRejectedValueOnce(new Error("lost transport response"));
    if (mode === "rejected") mocks.send.mockResolvedValueOnce({ status: "ERROR" });
    await submitControlIntent({
      deployment,
      tokenId: token.id,
      action: "subscription.cancel",
      intent: intent.intent,
      signedXdr: transaction.toXDR(),
      ip: "127.0.0.1",
      assertEligible: async () => undefined,
    });
    if (mode === "rejected")
      await db.serviceTransaction.updateMany({
        where: { txHash: intent.txHash },
        data: { state: "REJECTED" },
      });
  }
  return { deployment, token, intent };
}
async function assertSettled(id: string, hash: string) {
  expect(
    await db.signedTransaction.count({
      where: {
        deploymentId: id,
        OR: [{ outcome: null }, { outcome: { in: ["RECEIVED", "ACCEPTED", "UNRESOLVED"] } }],
      },
    }),
  ).toBe(0);
  expect(await db.serviceTransaction.count({ where: { txHash: hash, state: "PENDING" } })).toBe(0);
}
describe("proof-aware control retirement with real PostgreSQL", () => {
  it.each(["accepted", "unknown"] as const)(
    "proven expiry settles %s signer history and outbox without reopening on delayed replies",
    async (mode) => {
      const { deployment, token, intent } = await fixture(mode);
      const before = await db.signedTransaction.findUniqueOrThrow({
        where: { txHash: intent.txHash },
      });
      const eventsBefore = await db.analyticsDelivery.count({
        where: { distinctId: `api:${token.id}`, event: "transaction_outcome" },
      });
      await reconcileControlIntent(intent.intent, deployment.id, "subscription.cancel");
      const after = await db.signedTransaction.findUniqueOrThrow({
        where: { txHash: intent.txHash },
      });
      expect(after).toMatchObject({
        outcome: "REJECTED",
        failureCode: "CONTROL_EXPIRED",
        nextCheckAt: null,
        outcomeRevision: before.outcomeRevision + 1,
        submissionRevision: before.submissionRevision,
        acceptedAt: before.acceptedAt,
      });
      expect(
        await db.analyticsDelivery.count({
          where: { distinctId: `api:${token.id}`, event: "transaction_outcome" },
        }),
      ).toBe(eventsBefore + 1);
      expect(
        await db.analyticsDelivery.findFirst({
          where: {
            distinctId: `api:${token.id}`,
            event: "transaction_outcome",
            properties: { path: ["failure_code"], equals: "CONTROL_EXPIRED" },
          },
        }),
      ).not.toBeNull();
      await recordTransactionOutcome(intent.txHash, "ACCEPTED", {
        submissionAttempt: before.submissionRevision,
      });
      await recordTransactionOutcome(intent.txHash, "UNRESOLVED", {
        submissionAttempt: before.submissionRevision,
        failureCode: "RPC_UNAVAILABLE",
      });
      await reconcileControlIntent(intent.intent, deployment.id, "subscription.cancel");
      expect(
        await db.signedTransaction.findUniqueOrThrow({ where: { txHash: intent.txHash } }),
      ).toMatchObject({
        outcome: "REJECTED",
        failureCode: "CONTROL_EXPIRED",
        outcomeRevision: after.outcomeRevision,
      });
      expect(
        await db.analyticsDelivery.count({
          where: { distinctId: `api:${token.id}`, event: "transaction_outcome" },
        }),
      ).toBe(eventsBefore + 1);
      await assertSettled(deployment.id, intent.txHash);
      await requestRetirement(deployment.id, ownerId);
      mocks.get.mockRejectedValue(new Error("RPC history unavailable"));
      await reconcileRetirement(deployment.id);
      expect(
        (await db.deployment.findUniqueOrThrow({ where: { id: deployment.id } })).serviceState,
      ).toBe("RETIRED");
    },
  );
  it.each(["SUCCESS", "FAILED"] as const)(
    "retirement repairs crash after durable %s without RPC or a usable token",
    async (state) => {
      const { deployment, token, intent } = await fixture("unknown");
      await db.walletControlIntent.update({
        where: { id: intent.intent },
        data: { state, ledger: 99, completedAt: new Date() },
      });
      await requestRetirement(deployment.id, ownerId);
      expect(
        (await db.deploymentApiToken.findUniqueOrThrow({ where: { id: token.id } })).revokedAt,
      ).not.toBeNull();
      mocks.get.mockRejectedValue(new Error("no retained history"));
      await reconcileRetirement(deployment.id);
      expect(mocks.get).not.toHaveBeenCalled();
      expect(
        await db.signedTransaction.findUniqueOrThrow({ where: { txHash: intent.txHash } }),
      ).toMatchObject({
        outcome: state === "SUCCESS" ? "CONFIRMED" : "FAILED",
        ledger: 99,
        nextCheckAt: null,
      });
      await assertSettled(deployment.id, intent.txHash);
      expect(
        (await db.deployment.findUniqueOrThrow({ where: { id: deployment.id } })).serviceState,
      ).toBe("RETIRED");
    },
  );
  it.each(["SUCCESS", "FAILED", "EXPIRED"] as const)(
    "status repairs signed and admitted history from persisted %s",
    async (state) => {
      const { deployment, intent } = await fixture("unknown");
      await db.walletControlIntent.update({
        where: { id: intent.intent },
        data: { state, ledger: state === "EXPIRED" ? null : 99, completedAt: new Date() },
      });
      mocks.get.mockRejectedValue(new Error("history unavailable"));
      expect((await getTransactionStatus(deployment, intent.txHash)).status).toBe(
        state === "EXPIRED" ? "REJECTED" : state,
      );
      expect(mocks.get).not.toHaveBeenCalled();
      await assertSettled(deployment.id, intent.txHash);
    },
  );
  it("ordinary queue rejection cannot settle accepted history or impersonate expiry proof", async () => {
    const { deployment, intent } = await fixture();
    expect(
      await recordTransactionOutcome(intent.txHash, "REJECTED", {
        failureCode: "RPC_REJECTED",
        submissionAttempt: 1,
      }),
    ).toBe(false);
    expect(
      await recordTransactionOutcome(intent.txHash, "REJECTED", {
        failureCode: "CONTROL_EXPIRED",
        controlIntentId: intent.intent,
        deploymentId: deployment.id,
      }),
    ).toBe(false);
    expect(
      (await db.signedTransaction.findUniqueOrThrow({ where: { txHash: intent.txHash } })).outcome,
    ).toBe("ACCEPTED");
  });
  it("queue-rejected controls block retirement until ledger proof, including before cutoff", async () => {
    const { deployment, intent } = await fixture("rejected");
    await requestRetirement(deployment.id, ownerId);
    mocks.get.mockResolvedValue(lookup(expiry - 1));
    mocks.ledgers.mockResolvedValue({
      ledgers: [{ sequence: 100, ledgerCloseTime: String(expiry - 1) }],
    });
    await reconcileRetirement(deployment.id);
    expect(await db.deployment.findUniqueOrThrow({ where: { id: deployment.id } })).toMatchObject({
      serviceState: "RETIRING",
      retirementCutoffLedger: null,
      retirementBlocker: expect.stringContaining("wallet-control finality"),
    });
    mocks.get.mockResolvedValue(lookup());
    mocks.ledgers.mockResolvedValue({
      ledgers: [{ sequence: 100, ledgerCloseTime: String(expiry + 1) }],
    });
    await reconcileRetirement(deployment.id);
    await assertSettled(deployment.id, intent.txHash);
    expect(
      (await db.deployment.findUniqueOrThrow({ where: { id: deployment.id } })).serviceState,
    ).toBe("RETIRED");
  });
  it("unknown history gaps preserve every unresolved financial blocker", async () => {
    const { deployment, intent } = await fixture("unknown");
    await requestRetirement(deployment.id, ownerId);
    mocks.get.mockResolvedValue(lookup(expiry + 1, 91));
    await reconcileRetirement(deployment.id);
    expect(
      (await db.walletControlIntent.findUniqueOrThrow({ where: { id: intent.intent } })).state,
    ).toBe("SUBMITTING");
    expect(
      (await db.signedTransaction.findUniqueOrThrow({ where: { txHash: intent.txHash } })).outcome,
    ).toBe("UNRESOLVED");
    expect(
      await db.serviceTransaction.count({ where: { txHash: intent.txHash, state: "PENDING" } }),
    ).toBe(1);
    expect(await db.deployment.findUniqueOrThrow({ where: { id: deployment.id } })).toMatchObject({
      serviceState: "RETIRING",
      retirementCutoffLedger: null,
    });
  });
  it("abandoned preparations block retirement and reconcile without signed rows", async () => {
    const { deployment, intent } = await fixture("prepared");
    await requestRetirement(deployment.id, ownerId);
    mocks.get.mockResolvedValue(lookup(expiry - 1));
    mocks.ledgers.mockResolvedValue({
      ledgers: [{ sequence: 100, ledgerCloseTime: String(expiry - 1) }],
    });
    await reconcileRetirement(deployment.id);
    expect(
      (await db.deployment.findUniqueOrThrow({ where: { id: deployment.id } })).serviceState,
    ).toBe("RETIRING");
    mocks.get.mockResolvedValue(lookup());
    mocks.ledgers.mockResolvedValue({
      ledgers: [{ sequence: 100, ledgerCloseTime: String(expiry + 1) }],
    });
    await reconcileRetirement(deployment.id);
    expect(
      (await db.walletControlIntent.findUniqueOrThrow({ where: { id: intent.intent } })).state,
    ).toBe("EXPIRED");
    expect(
      (await db.deployment.findUniqueOrThrow({ where: { id: deployment.id } })).serviceState,
    ).toBe("RETIRED");
  });
  it.each(["before", "after"] as const)(
    "retains actual ledger failure observed %s expiry repair",
    async (timing) => {
      const { deployment, intent } = await fixture("unknown");
      const recordFailure = () =>
        recordTransactionOutcome(intent.txHash, "FAILED", {
          ledger: 99,
          failureCode: "ONCHAIN_FAILED",
          deploymentId: deployment.id,
        });
      if (timing === "before") await recordFailure();
      const proof = await db.walletControlIntent.update({
        where: { id: intent.intent },
        data: { state: "EXPIRED", completedAt: new Date() },
      });
      await repairControlAdmission(proof);
      if (timing === "after") {
        expect(
          (await db.signedTransaction.findUniqueOrThrow({ where: { txHash: intent.txHash } }))
            .failureCode,
        ).toBe("CONTROL_EXPIRED");
        await recordFailure();
      }
      expect(
        await db.signedTransaction.findUniqueOrThrow({ where: { txHash: intent.txHash } }),
      ).toMatchObject({ outcome: "FAILED", ledger: 99 });
    },
  );
  it("retains unresolved other-network intents as conservative cutoff blockers", async () => {
    const { deployment, intent } = await fixture("prepared");
    await db.walletControlIntent.update({
      where: { id: intent.intent },
      data: { network: "mainnet" },
    });
    await requestRetirement(deployment.id, ownerId);
    await reconcileRetirement(deployment.id);
    expect(await db.deployment.findUniqueOrThrow({ where: { id: deployment.id } })).toMatchObject({
      serviceState: "RETIRING",
      retirementCutoffLedger: null,
    });
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
