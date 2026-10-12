import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  StrKey,
} from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
const mocks = vi.hoisted(() => ({ send: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ sendTransaction: mocks.send, getTransaction: mocks.get }),
}));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
import { db } from "@/lib/db";
import {
  createControlIntent,
  reconcileControlIntent,
  type WalletControlAction,
} from "@/lib/api/v1/control-intent";
import { submitControlIntent } from "@/lib/api/v1/control-submission";
let ownerId: string;
const deployments: string[] = [];
const flows: string[] = [];
const contract = StrKey.encodeContract(Buffer.alloc(32, 21));
const wallets = [Keypair.random(), Keypair.random(), Keypair.random()];
beforeAll(async () => {
  ownerId = (
    await db.user.create({
      data: { username: `funding-${randomUUID()}`, passwordHash: "synthetic-only" },
    })
  ).id;
});
afterAll(async () => {
  for (const deploymentId of deployments) {
    await db.serviceTransaction.deleteMany({ where: { work: { deploymentId } } });
    await db.deploymentWork.deleteMany({ where: { deploymentId } });
    await db.walletControlIntent.deleteMany({ where: { deploymentId } });
    await db.signedTransaction.deleteMany({ where: { deploymentId } });
    await db.auditLog.deleteMany({
      where: { metadata: { path: ["deploymentId"], equals: deploymentId } },
    });
    await db.deployment.delete({ where: { id: deploymentId } });
  }
  for (const id of flows) await db.flow.delete({ where: { id } });
  if (ownerId) await db.user.delete({ where: { id: ownerId } });
});
describe("funding durable admission across consenting funders", () => {
  it.each([
    ["STREAMER", "top_up", "schedule.fund"],
    ["WEBHOOK", "deposit", "webhook.fund"],
  ] as const)(
    "%s serializes preparations and uncertain concurrent submission without a duplicate deposit",
    async (kind, method, action) => {
      mocks.send.mockReset();
      mocks.get.mockReset();
      mocks.get.mockResolvedValue({ status: "NOT_FOUND" });
      const flow = await db.flow.create({
        data: { ownerId, name: "funding protocol", templateKind: kind, graph: {}, parameters: {} },
      });
      flows.push(flow.id);
      const deployment: Deployment = await db.deployment.create({
        data: {
          ownerId,
          flowId: flow.id,
          network: "testnet",
          status: "CONFIRMED",
          graphSnapshot: {},
          paramsSnapshot: {},
          pipelineSnapshot: [{ nodeId: "pool", templateKind: kind, contractAddress: contract }],
        },
      });
      deployments.push(deployment.id);
      const token = await db.deploymentApiToken.create({
        data: {
          deploymentId: deployment.id,
          createdById: ownerId,
          tokenHash: randomUUID(),
          tokenPrefix: "pfk_test",
        },
      });
      const expiry = Math.floor(Date.now() / 1000) + 180;
      function transaction(wallet: Keypair, sequence = "10") {
        return new TransactionBuilder(new Account(wallet.publicKey(), sequence), {
          fee: "100",
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(
            new Contract(contract).call(
              method,
              new Address(wallet.publicKey()).toScVal(),
              nativeToScVal(12345678901234567890n, { type: "i128" }),
            ),
          )
          .setTimebounds(0, expiry)
          .build();
      }
      async function prepare(wallet: Keypair, sequence = "10") {
        return createControlIntent({
          deployment,
          nodeId: "pool",
          action: action as WalletControlAction,
          walletAddress: wallet.publicKey(),
          unsignedXdr: transaction(wallet, sequence).toXDR(),
          preparationLedger: 90,
        });
      }
      const reservations = await Promise.allSettled(wallets.map((wallet) => prepare(wallet)));
      expect(reservations.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(reservations.filter((r) => r.status === "rejected")).toHaveLength(2);
      const intent = await db.walletControlIntent.findFirstOrThrow({
        where: { deploymentId: deployment.id },
      });
      const wallet = wallets.find((wallet) => wallet.publicKey() === intent.walletAddress)!;
      // Recreate with persisted exact envelope timebounds to avoid wall-clock fixture drift.
      const signed = transaction(wallet);
      signed.sign(wallet);
      mocks.send.mockImplementation(async (tx) => {
        const hash = tx.hash().toString("hex");
        expect(hash).toBe(intent.txHash);
        expect(
          await db.serviceTransaction.count({
            where: { txHash: hash, work: { deploymentId: deployment.id } },
          }),
        ).toBe(1);
        expect(
          await db.signedTransaction.count({
            where: { txHash: hash, deploymentId: deployment.id },
          }),
        ).toBe(1);
        throw new Error("synthetic transport uncertainty");
      });
      const submit = () =>
        submitControlIntent({
          deployment,
          tokenId: token.id,
          action,
          intent: intent.id,
          signedXdr: signed.toXDR(),
          ip: "127.0.0.1",
          assertEligible: async () => undefined,
        });
      const outcomes = await Promise.all([submit(), submit(), submit()]);
      expect(mocks.send).toHaveBeenCalledTimes(1);
      expect(outcomes.some((r) => r.status === "UNKNOWN")).toBe(true);
      await expect(prepare(wallet, "11")).rejects.toMatchObject({ code: "CONFLICT" });
      mocks.get.mockResolvedValue({ status: "FAILED", ledger: 100 });
      expect((await reconcileControlIntent(intent.id, deployment.id, action)).state).toBe("FAILED");
      expect((await prepare(wallet, "12")).intent).not.toBe(intent.id);
      await db.deployment.update({
        where: { id: deployment.id },
        data: { serviceState: "RETIRING", retirementRequestedAt: new Date() },
      });
      await expect(prepare(wallet, "13")).rejects.toMatchObject({ code: "CONFLICT" });
    },
  );
});
