/** Integrated route/SDK/DB seam. Only RPC, unsigned-envelope construction and event
 * ingestion are simulated; auth, durable admission, attribution, outcomes and audits are real. */
import { randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import {
  Account,
  Address,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  type Transaction,
} from "@stellar/stellar-sdk";
import { NextRequest } from "next/server";
import { afterAll, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  send: vi.fn(),
  prepare: vi.fn(),
  relayerSimulate: vi.fn(),
  relayerSend: vi.fn(),
  history: vi.fn(async (_record: unknown) => true),
}));
vi.mock("@/lib/stellar/relayer", () => ({
  simulateReleaseByRelayer: mocks.relayerSimulate,
  sendReleaseByRelayer: mocks.relayerSend,
}));
vi.mock("@/lib/stellar/relayer-channels", () => ({
  withRelayerChannel: (callback: (channel: unknown) => Promise<unknown>) => callback({}),
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ getTransaction: mocks.get, sendTransaction: mocks.send }),
}));
vi.mock("@/lib/stellar/trigger", () => ({ prepareTriggerTx: mocks.prepare }));
vi.mock("@/lib/stellar/events", () => ({ pollEventsFor: async () => 0 }));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/api/request-history/delivery", () => ({ queueApiRequest: mocks.history }));
import { db } from "@/lib/db";
import { hashApiToken } from "@/lib/auth/api-token";
import { beforeServiceSubmission, observeServiceTransaction } from "@/lib/deployments/service-work";
import { POST as release } from "@/app/api/v1/deployments/[id]/release-early/route";
import { POST as prepare } from "@/app/api/v1/deployments/[id]/execute/route";
import { POST as submit } from "@/app/api/v1/deployments/[id]/execute/submit/route";
import { GET as status } from "@/app/api/v1/deployments/[id]/transactions/[txHash]/route";
import type { signPrepared as SignPrepared, Paiflow as Client } from "@/packages/sdk/src/index";
import type { ApiRequestRecord } from "@/lib/api/request-history/schema";

const fixture = `journey-${randomUUID()}`;
const ids: string[] = [],
  tokens: string[] = [],
  hashes: string[] = [];
let owner: string | undefined;
afterAll(async () => {
  // Delete only this test's rows; never wipe a shared database/table.
  await db.analyticsDelivery.deleteMany({ where: { distinctId: owner ?? fixture } });
  await db.signedTransaction.deleteMany({ where: { txHash: { in: hashes } } });
  await db.developerTokenGrant.deleteMany({ where: { tokenId: { in: tokens } } });
  await db.developerApiToken.deleteMany({ where: { id: { in: tokens } } });
  await db.serviceTransaction.deleteMany({ where: { work: { deploymentId: { in: ids } } } });
  await db.deploymentWork.deleteMany({ where: { deploymentId: { in: ids } } });
  await db.deployment.deleteMany({ where: { id: { in: ids } } });
  if (owner) {
    await db.flow.deleteMany({ where: { ownerId: owner } });
    await db.auditLog.deleteMany({ where: { userId: owner } });
    await db.user.delete({ where: { id: owner } });
  }
});

// Normal CI exercises real routes/DB with the built SDK; the explicit local runner
// additionally selects the installed packed artifact (no registry/network calls).
it("preserves separate wallet consent, first attribution and unknown work through grant removal/replacement", async () => {
  owner = (
    await db.user.create({
      data: { username: fixture, passwordHash: "unused", analyticsAudience: "EXTERNAL" },
    })
  ).id;
  const contract = StrKey.encodeContract(Buffer.alloc(32, 22));
  const graph = {
    nodes: [
      { id: "root", type: "on_receive", config: { asset: { kind: "native" } } },
      {
        id: "pay",
        type: "pay",
        config: {
          asset: { kind: "native" },
          recipient: Keypair.random().publicKey(),
          fullAmount: true,
        },
      },
    ],
    edges: [{ id: "edge", source: "root", target: "pay" }],
  };
  for (let i = 0; i < 2; i++) {
    const flow = await db.flow.create({
      data: {
        ownerId: owner,
        name: fixture,
        templateKind: "DEPOSIT_TRIGGER",
        graph,
        parameters: {},
      },
    });
    ids.push(
      (
        await db.deployment.create({
          data: {
            ownerId: owner,
            flowId: flow.id,
            status: "CONFIRMED",
            network: "testnet",
            graphSnapshot: graph,
            paramsSnapshot: {},
            pipelineSnapshot: [
              { nodeId: "root", templateKind: "DEPOSIT_TRIGGER", contractAddress: contract },
            ],
          },
        })
      ).id,
    );
  }
  async function issue() {
    const raw = `pfd_${randomBytes(32).toString("hex")}`;
    const row = await db.developerApiToken.create({
      data: {
        ownerId: owner!,
        tokenHash: hashApiToken(raw),
        tokenPrefix: raw.slice(0, 12),
        permission: "READ_OPERATE",
        grants: { create: ids.map((deploymentId) => ({ deploymentId })) },
      },
    });
    tokens.push(row.id);
    return { raw, id: row.id };
  }
  const original = await issue();
  const replacement = await issue();
  const packed = "/tmp/paiflow-dev-token-verify/node_modules/@paiflow/sdk/dist/index.js";
  const { Paiflow, signPrepared } = (await (existsSync(packed)
    ? import(/* @vite-ignore */ pathToFileURL(packed).href)
    : import("@/packages/sdk/src/index"))) as {
    Paiflow: typeof Client;
    signPrepared: typeof SignPrepared;
  };
  const adapter: typeof fetch = async (input, init) => {
    const req = new NextRequest(String(input), { ...init, signal: init?.signal ?? undefined });
    const parts = new URL(req.url).pathname.split("/");
    const id = parts[4]!;
    if (parts[5] === "transactions")
      return status(req, { params: Promise.resolve({ id, txHash: parts[6]! }) });
    if (parts[5] === "execute" && parts[6] === "submit")
      return submit(req, { params: Promise.resolve({ id }) });
    if (parts[5] === "release-early") return release(req, { params: Promise.resolve({ id }) });
    if (parts[5] === "execute") return prepare(req, { params: Promise.resolve({ id }) });
    throw new Error("Unexpected fixture route");
  };
  const client = (token: string) =>
    new Paiflow({ baseUrl: "https://local-fixture.invalid", token, fetch: adapter });
  const initial = client(original.raw).deployment(ids[0]!);
  const recovered = client(replacement.raw).deployment(ids[0]!);
  const wallet = Keypair.random();
  mocks.prepare.mockImplementation(
    async (input: { fromAddress: string; amount: string; contractAddress: string }) => ({
      xdr: new TransactionBuilder(new Account(input.fromAddress, "10"), {
        fee: "100",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.invokeContractFunction({
            contract: input.contractAddress,
            function: "deposit",
            args: [
              new Address(input.fromAddress).toScVal(),
              nativeToScVal(BigInt(input.amount), { type: "i128" }),
            ],
          }),
        )
        .setTimeout(180)
        .build()
        .toXDR(),
    }),
  );
  mocks.get.mockResolvedValue({ status: "NOT_FOUND", latestLedger: 123 });
  mocks.send.mockImplementation(async (tx: Transaction) => {
    // The real client normally records these before/after RPC. Retain that
    // boundary while intercepting bytes so no external call can happen here.
    await beforeServiceSubmission(tx.hash().toString("hex"), "rpc");
    return { status: "PENDING", hash: tx.hash().toString("hex") };
  });
  const prepared = await initial.execute.prepare({ from: wallet.publicKey(), amount: "10000000" });
  expect(prepared.metadata.historyRequestId).toBeTruthy();
  expect(mocks.send.mock.calls.length).toBe(0);
  // Consent/signing is outside the token client. Sign the exact synthetic preparation.
  let consented = false;
  const signed = await signPrepared(
    prepared,
    async (request) => {
      consented = true;
      const tx = TransactionBuilder.fromXDR(request.xdr, request.networkPassphrase) as Transaction;
      tx.sign(wallet);
      return { signedXdr: tx.toXDR() };
    },
    { walletAddress: wallet.publicKey() },
  );
  expect(consented).toBe(true);
  await db.developerTokenGrant.delete({
    where: { tokenId_deploymentId: { tokenId: original.id, deploymentId: ids[0]! } },
  });
  await expect(
    initial.execute.submit({ signedXdr: signed.submission.signedXdr }),
  ).rejects.toMatchObject({
    status: 401,
  });
  expect(mocks.send.mock.calls.length).toBe(0);
  await db.developerTokenGrant.create({ data: { tokenId: original.id, deploymentId: ids[0]! } });
  const pending = await initial.execute.submit(
    { signedXdr: signed.submission.signedXdr },
    { wait: false, ...signed.submissionOptions },
  );
  expect(pending.data.status).toBe("PENDING");
  const hash = pending.data.txHash;
  hashes.push(hash);
  const durable = await db.signedTransaction.findUniqueOrThrow({ where: { txHash: hash } });
  expect(durable).toMatchObject({
    deploymentId: ids[0],
    developerApiTokenId: original.id,
    apiTokenId: null,
    callerAccountId: owner,
    userId: null,
    signerAddress: wallet.publicKey(),
    outcome: "ACCEPTED",
    signedBySource: true,
  });
  expect(await db.serviceTransaction.count({ where: { txHash: hash, state: "PENDING" } })).toBe(1);
  await db.developerApiToken.update({
    where: { id: original.id },
    data: { revokedAt: new Date() },
  });
  await expect(initial.transactions.get(hash)).rejects.toMatchObject({ status: 401 });
  // Missing finality remains unresolved. Recovery uses an explicitly authorized replacement.
  const unknown = await recovered.transactions.get(hash);
  expect(["PENDING", "UNKNOWN"]).toContain(unknown.data.status);
  expect(await db.signedTransaction.count({ where: { txHash: hash } })).toBe(1);
  expect(await db.serviceTransaction.count({ where: { txHash: hash, state: "PENDING" } })).toBe(1);
  // A shared credential does not make an existing hash portable to a second deployment,
  // even if a malformed fixture repeats the contract address in both snapshots.
  const sends = mocks.send.mock.calls.length;
  await expect(
    client(replacement.raw)
      .deployment(ids[1]!)
      .execute.submit({ signedXdr: signed.submission.signedXdr }, { wait: false }),
  ).rejects.toMatchObject({ status: 409 });
  expect(mocks.send.mock.calls.length).toBe(sends);
  mocks.get.mockResolvedValue({ status: "SUCCESS", ledger: 124 });
  const terminal = await recovered.execute.submit(
    { signedXdr: signed.submission.signedXdr },
    { wait: false },
  );
  expect(terminal.data.status).toBe("SUCCESS");
  expect(mocks.send.mock.calls.length).toBe(sends);
  expect(await db.signedTransaction.findUniqueOrThrow({ where: { txHash: hash } })).toMatchObject({
    developerApiTokenId: original.id,
    outcome: "CONFIRMED",
    ledger: 124,
  });
  expect((await recovered.transactions.get(hash)).data.status).toBe("SUCCESS");
  const history = mocks.history.mock.calls.map(([record]) => record as ApiRequestRecord);
  expect(
    history.some(
      (record) =>
        record.preparationRequestId === prepared.metadata.historyRequestId &&
        record.txHash === hash &&
        record.developerApiTokenId === original.id,
    ),
  ).toBe(true);
  expect(
    history.some(
      (record) => record.txHash === hash && record.developerApiTokenId === replacement.id,
    ),
  ).toBe(true);
  const serialized = JSON.stringify(history);
  for (const sensitive of [
    original.raw,
    replacement.raw,
    signed.submission.signedXdr,
    hashApiToken(original.raw),
  ])
    expect(serialized.includes(sensitive)).toBe(false);
  // Supported relayer early release uses explicit operate authorization. Only the
  // simulation/channel/send boundary is synthetic; node resolution and audit are real.
  const relayerHash = randomBytes(32).toString("hex");
  await db.deployment.update({
    where: { id: ids[1]! },
    data: {
      pipelineSnapshot: [
        { nodeId: "lock", templateKind: "TIMELOCK_BRANCH", contractAddress: contract },
      ],
    },
  });
  mocks.relayerSimulate.mockResolvedValue({ ok: true, sim: {} });
  mocks.relayerSend.mockImplementation(async () => {
    await beforeServiceSubmission(relayerHash, "rpc");
    await observeServiceTransaction(relayerHash, "SUCCESS", 125);
    return { status: "SUCCESS", txHash: relayerHash, ledger: 125 };
  });
  expect(
    (await client(replacement.raw).deployment(ids[1]!).releaseEarly({ nodeId: "lock" })).data
      .nodeId,
  ).toBe("lock");
  expect(mocks.relayerSimulate.mock.calls[0]?.slice(0, 2)).toEqual([contract, "before"]);
  expect(mocks.relayerSend.mock.calls.length).toBe(1);
  expect(
    await db.auditLog.count({
      where: {
        userId: owner,
        action: "API_TIMELOCK_RELEASE_BEFORE",
        metadata: { path: ["tokenType"], equals: "developer_token" },
      },
    }),
  ).toBe(1);
  // Retirement is irreversible: pending admitted work survives and new operations stop.
  mocks.get.mockResolvedValue({ status: "NOT_FOUND", latestLedger: 123 });
  const secondWallet = Keypair.random();
  const secondPrepared = await recovered.execute.prepare({
    from: secondWallet.publicKey(),
    amount: "10000000",
  });
  const secondSigned = await signPrepared(
    secondPrepared,
    async (request) => {
      const tx = TransactionBuilder.fromXDR(request.xdr, request.networkPassphrase) as Transaction;
      tx.sign(secondWallet);
      return { signedXdr: tx.toXDR() };
    },
    { walletAddress: secondWallet.publicKey() },
  );
  const secondPending = await recovered.execute.submit(secondSigned.submission, { wait: false });
  hashes.push(secondPending.data.txHash);
  await db.deployment.update({
    where: { id: ids[0]! },
    data: { serviceState: "RETIRING", retirementRequestedAt: new Date() },
  });
  const beforeRefusal = mocks.send.mock.calls.length;
  await expect(
    recovered.execute.submit(secondSigned.submission, { wait: false }),
  ).rejects.toMatchObject({ status: 401 });
  expect(mocks.send.mock.calls.length).toBe(beforeRefusal);
  expect(
    await db.serviceTransaction.count({
      where: { txHash: secondPending.data.txHash, state: "PENDING" },
    }),
  ).toBe(1);
  expect(
    await db.signedTransaction.count({
      where: { txHash: secondPending.data.txHash, outcome: "ACCEPTED" },
    }),
  ).toBe(1);
  // Explicit synthetic finality observation clears this fixture's admitted pending record.
  await observeServiceTransaction(hash, "SUCCESS");
});
