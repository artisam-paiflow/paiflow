import type { Prisma, SignedTransaction } from "@prisma/client";
import {
  Account,
  Address,
  Asset,
  Keypair,
  Networks,
  Operation,
  StrKey,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LegacySubmissionDeployment } from "@/lib/stellar/legacy-submission";

// Real preparation/admission/signatures and submission classification; only the
// external store/RPC are replaced. Separate PostgreSQL tests prove row locking.
const mock = vi.hoisted(() => ({
  deployment: null as LegacySubmissionDeployment | null,
  preparations: new Map<string, Prisma.WalletSubmissionPreparationCreateManyInput>(),
  journals: new Map<string, SignedTransaction>(),
  unsignedXdr: "",
  insert: vi.fn(),
  audit: vi.fn(),
  session: vi.fn(),
  send: vi.fn(),
  get: vi.fn(),
  capture: vi.fn(),
}));
vi.mock("@/lib/db", () => {
  const db = {
    deployment: {
      findFirst: vi.fn(async () => mock.deployment),
      findUnique: vi.fn(async () => mock.deployment),
    },
    walletSubmissionPreparation: {
      createMany: vi.fn(
        async ({ data }: { data: Prisma.WalletSubmissionPreparationCreateManyInput[] }) => {
          for (const row of data)
            if (!mock.preparations.has(row.txHash)) mock.preparations.set(row.txHash, row);
        },
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { txHash: string } }) =>
          mock.preparations.get(where.txHash) ?? null,
      ),
    },
    signedTransaction: {
      findUnique: vi.fn(
        async ({ where }: { where: { txHash: string } }) => mock.journals.get(where.txHash) ?? null,
      ),
    },
    $transaction: async <T>(callback: (client: unknown) => Promise<T>): Promise<T> => callback(db),
  };
  return { db };
});
vi.mock("@/lib/deployments/service-route", () => ({
  deploymentServiceRoute: (handler: unknown) => handler,
}));
vi.mock("@/lib/deployments/service-work", () => ({
  lockDeployment: vi.fn(async () => ({ serviceState: "ACTIVE" })),
}));
vi.mock("@/lib/signed-tx", async (original) => ({
  ...(await original<typeof import("@/lib/signed-tx")>()),
  insertSignedTransaction: mock.insert,
  captureTransactionSigned: mock.capture,
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ sendTransaction: mock.send, getTransaction: mock.get }),
}));
vi.mock("@/lib/stellar/invoke", () => ({}));
vi.mock("@/lib/stellar/pipeline-error-hint", () => ({
  buildPipelineErrorHint: vi.fn(async () => undefined),
}));
vi.mock("@/lib/analytics/outcomes", () => ({
  beginTransactionSubmission: vi.fn(async () => undefined),
  recordTransactionOutcome: vi.fn(async () => false),
}));
vi.mock("@/lib/audit", () => ({ audit: mock.audit, needsSubmitRow: vi.fn(async () => true) }));
vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(async () => null),
  requireSession: mock.session,
}));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: () => "127.0.0.1",
  enforceRateLimit: vi.fn(async () => undefined),
}));
vi.mock("@/lib/stellar/trigger", async (original) => ({
  ...(await original<typeof import("@/lib/stellar/trigger")>()),
  prepareTriggerTx: vi.fn(async () => ({ xdr: mock.unsignedXdr })),
  prepareWebhookDepositTx: vi.fn(async () => ({ xdr: mock.unsignedXdr })),
}));

import { POST as prepareTrigger } from "@/app/api/deployments/[id]/trigger/route";
import { POST as submitTrigger } from "@/app/api/deployments/[id]/submit-trigger/route";
import { POST as submitInvoke } from "@/app/api/deployments/[id]/submit-invoke/route";
import { registerLegacyPreparation } from "@/lib/stellar/legacy-submission";
import { AppError } from "@/lib/errors";
import { beginTransactionSubmission, recordTransactionOutcome } from "@/lib/analytics/outcomes";
import { ctx, request } from "./v1/execute-fixtures";

const SOURCE = Keypair.random();
const ROOT = StrKey.encodeContract(Buffer.alloc(32, 4));
const OTHER = StrKey.encodeContract(Buffer.alloc(32, 6));
const ID = "11111111-1111-1111-1111-111111111111";

function deployment(streamer = false): LegacySubmissionDeployment {
  return {
    id: ID,
    network: "testnet",
    status: "CONFIRMED",
    contractAddress: ROOT,
    sourceAccount: SOURCE.publicKey(),
    paramsSnapshot: {},
    pipelineSnapshot: [
      {
        nodeId: "root",
        templateKind: streamer ? "STREAMER" : "DEPOSIT_TRIGGER",
        contractAddress: ROOT,
      },
    ],
    graphSnapshot: {
      nodes: [
        streamer
          ? {
              id: "root",
              type: "on_schedule",
              config: {
                intervalUnit: "day",
                startsAt: "2026-11-01T00:00:00Z",
                pauseAllowed: true,
                retrieveAllowed: true,
              },
            }
          : { id: "root", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "pay",
          type: "pay",
          config: { asset: { kind: "native" }, recipient: SOURCE.publicKey(), fullAmount: true },
        },
      ],
      edges: [{ id: "edge", source: "root", target: "pay" }],
    },
    chargeRelayerMode: "MANUAL",
    chargeRelayerAddress: null,
    flow: { templateKind: streamer ? "STREAMER" : "SPLITTER" },
  };
}

function transaction(
  options: {
    method?: string;
    target?: string;
    amount?: bigint;
    fee?: string;
    network?: string;
    classic?: boolean;
  } = {},
) {
  const method = options.method ?? "deposit";
  return new TransactionBuilder(new Account(SOURCE.publicKey(), "10"), {
    fee: options.fee ?? "100",
    networkPassphrase: options.network ?? Networks.TESTNET,
  })
    .addOperation(
      options.classic
        ? Operation.payment({
            destination: Keypair.random().publicKey(),
            asset: Asset.native(),
            amount: "1",
          })
        : Operation.invokeContractFunction({
            contract: options.target ?? ROOT,
            function: method,
            args: ["pause", "unpause", "retrieve_unvested"].includes(method)
              ? []
              : [
                  new Address(SOURCE.publicKey()).toScVal(),
                  nativeToScVal(options.amount ?? 200n, { type: "i128" }),
                ],
          }),
    )
    .setTimeout(180)
    .build();
}

function signed(tx: Transaction, key = SOURCE) {
  tx.sign(key);
  return tx.toXDR();
}

async function approve(tx: Transaction, streamer = false) {
  await registerLegacyPreparation({
    deployment: deployment(streamer),
    kind: streamer ? "INVOKE" : "TRIGGER",
    unsignedXdr: tx.toXDR(),
    sourceAddress: SOURCE.publicKey(),
    contractAddress: ROOT,
    method: streamer ? "pause" : "deposit",
    ...(streamer ? {} : { amount: "200" }),
  });
}

const submit = (value: string, invoke = false) =>
  (invoke ? submitInvoke : submitTrigger)(
    request(`/api/deployments/${ID}/${invoke ? "submit-invoke" : "submit-trigger"}`, {
      body: { signedXdr: value },
    }),
    ctx(),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mock.deployment = deployment();
  mock.preparations.clear();
  mock.journals.clear();
  mock.session.mockResolvedValue({ id: "owner" });
  mock.get.mockResolvedValue({ status: "NOT_FOUND" });
  mock.send.mockImplementation(async (tx: Transaction) => {
    expect(mock.journals.has(tx.hash().toString("hex"))).toBe(true);
    return { status: "PENDING", hash: tx.hash().toString("hex") };
  });
  mock.insert.mockImplementation(async (row: Prisma.SignedTransactionUncheckedCreateInput) => {
    if (mock.journals.has(row.txHash)) return false;
    mock.journals.set(row.txHash, { ...row, ledger: null } as SignedTransaction);
    return true;
  });
});
afterEach(() => vi.useRealTimers());

describe("legacy submission boundary through actual route handlers", () => {
  it("persists the exact simulated preparation before acknowledging anonymous funding", async () => {
    const tx = transaction();
    mock.unsignedXdr = tx.toXDR();
    const result = await prepareTrigger(
      request(`/api/deployments/${ID}/trigger`, {
        body: { amount: "200", userAddress: SOURCE.publicKey() },
      }),
      ctx(),
    );
    expect(result.status).toBe(200);
    expect(mock.preparations.get(tx.hash().toString("hex"))).toMatchObject({
      deploymentId: ID,
      kind: "TRIGGER",
      sourceAddress: SOURCE.publicKey(),
      method: "deposit",
      amountStroops: "200",
    });
    const response = await submit(signed(tx));
    expect(response.status).toBe(200);
    expect(mock.insert).toHaveBeenCalledOnce();
    expect(mock.send).toHaveBeenCalledOnce();
    expect(mock.journals.get(tx.hash().toString("hex"))?.userId).toBeNull();
  });

  it.each([
    ["unsigned", () => transaction().toXDR(), 403],
    ["wrong key", () => signed(transaction(), Keypair.random()), 403],
    ["wrong network", () => signed(transaction({ network: Networks.PUBLIC })), 403],
    ["unrelated classic payment", () => signed(transaction({ classic: true })), 422],
    ["unprepared funding", () => signed(transaction()), 422],
    ["other contract", () => signed(transaction({ target: OTHER })), 422],
    ["unrelated approval", () => signed(transaction({ method: "approve" })), 422],
  ] as const)("refuses %s before journal, audit or RPC", async (_name, envelope, status) => {
    const result = await submit(envelope());
    expect(result.status).toBe(status);
    expect(mock.insert).not.toHaveBeenCalled();
    expect(mock.capture).not.toHaveBeenCalled();
    expect(mock.audit).not.toHaveBeenCalled();
    expect(mock.get).not.toHaveBeenCalled();
    expect(mock.send).not.toHaveBeenCalled();
  });

  it.each([{ amount: 201n }, { fee: "101" }])(
    "refuses a body changed after preparation: %s",
    async (change) => {
      await approve(transaction());
      expect((await submit(signed(transaction(change)))).status).toBe(422);
      expect(mock.insert).not.toHaveBeenCalled();
      expect(mock.send).not.toHaveBeenCalled();
    },
  );

  it("refuses another deployment's exact prepared hash before attributing it", async () => {
    const tx = transaction();
    await approve(tx);
    mock.deployment = { ...deployment(), id: "22222222-2222-4222-8222-222222222222" };
    const response = await submit(signed(tx));
    expect(response.status).toBe(422);
    expect(mock.journals.size).toBe(0);
    expect(mock.send).not.toHaveBeenCalled();
  });

  it("refuses fresh expired preparations without claiming their transaction failed", async () => {
    const tx = transaction();
    await approve(tx);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 600_000);
    const response = await submit(signed(tx));
    expect(response.status).toBe(422);
    expect(mock.journals.size).toBe(0);
    expect(mock.preparations.has(tx.hash().toString("hex"))).toBe(true);
    expect(mock.send).not.toHaveBeenCalled();
  });

  it("retains an unknown original duplicate without resending or writing another submit audit", async () => {
    const tx = transaction();
    await approve(tx);
    const envelope = signed(tx);
    expect((await submit(envelope)).status).toBe(200);
    mock.audit.mockClear();
    const response = await submit(envelope);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      txHash: tx.hash().toString("hex"),
      status: "PENDING",
    });
    expect(mock.send).toHaveBeenCalledOnce();
    expect(mock.insert).toHaveBeenCalledOnce();
    expect(mock.audit).not.toHaveBeenCalled();
    expect(beginTransactionSubmission).toHaveBeenCalledOnce();
  });

  it.each([0, -1, null])("does not infer durable finality from ledger %s", async (ledger) => {
    const tx = transaction();
    await approve(tx);
    const envelope = signed(tx);
    await submit(envelope);
    const row = mock.journals.get(tx.hash().toString("hex"))!;
    mock.journals.set(row.txHash, { ...row, outcome: "CONFIRMED", ledger });
    mock.audit.mockClear();
    const response = await submit(envelope);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ txHash: row.txHash, status: "PENDING" });
    expect(mock.get).toHaveBeenLastCalledWith(row.txHash);
    expect(mock.send).toHaveBeenCalledOnce();
    expect(beginTransactionSubmission).toHaveBeenCalledOnce();
    expect(mock.audit).not.toHaveBeenCalled();
  });

  it.each([0, -1, undefined])(
    "refuses provider finality without a positive ledger: %s",
    async (ledger) => {
      const tx = transaction();
      await approve(tx);
      mock.get.mockResolvedValue({ status: "SUCCESS", ledger });
      const response = await submit(signed(tx));
      expect(response.status).toBe(502);
      expect((await response.json()).error.message).toContain("valid ledger proof");
      expect(recordTransactionOutcome).not.toHaveBeenCalled();
      expect(mock.send).not.toHaveBeenCalled();
      expect(beginTransactionSubmission).not.toHaveBeenCalled();
    },
  );

  it("recovers durable original finality after envelope expiry and provider retention", async () => {
    const tx = transaction();
    await approve(tx);
    const envelope = signed(tx);
    await submit(envelope);
    const row = mock.journals.get(tx.hash().toString("hex"))!;
    mock.journals.set(row.txHash, { ...row, outcome: "CONFIRMED", ledger: 123 });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 600_000);
    mock.get.mockClear();
    const response = await submit(envelope);
    expect(response.status).toBe(200);
    expect((await response.json()).data.txHash).toBe(row.txHash);
    expect(mock.get).not.toHaveBeenCalled();
    expect(mock.send).toHaveBeenCalledOnce();
  });

  it("preserves authenticated streamer controls with an exact preparation", async () => {
    mock.deployment = deployment(true);
    const tx = transaction({ method: "pause" });
    await approve(tx, true);
    expect((await submit(signed(tx), true)).status).toBe(200);
    expect(mock.send).toHaveBeenCalledOnce();
    expect(mock.journals.get(tx.hash().toString("hex"))).toMatchObject({
      kind: "INVOKE",
      userId: "owner",
    });
  });

  it.each(["unsigned", "wrong key", "wrong network"])(
    "refuses an authenticated %s invoke envelope before admission or RPC",
    async (caseName) => {
      mock.deployment = deployment(true);
      const tx = transaction({
        method: "pause",
        network: caseName === "wrong network" ? Networks.PUBLIC : Networks.TESTNET,
      });
      const envelope =
        caseName === "unsigned"
          ? tx.toXDR()
          : signed(tx, caseName === "wrong key" ? Keypair.random() : SOURCE);
      const response = await submit(envelope, true);
      expect(response.status).toBe(403);
      expect(mock.session).toHaveBeenCalledOnce();
      expect(mock.insert).not.toHaveBeenCalled();
      expect(mock.audit).not.toHaveBeenCalled();
      expect(mock.get).not.toHaveBeenCalled();
      expect(mock.send).not.toHaveBeenCalled();
    },
  );

  it("requires a live authenticated session for generic invoke submission", async () => {
    mock.session.mockRejectedValue(new AppError("UNAUTHENTICATED", "Session ended"));
    const response = await submit(signed(transaction()), true);
    expect(response.status).toBe(401);
    expect(mock.insert).not.toHaveBeenCalled();
    expect(mock.send).not.toHaveBeenCalled();
  });
});
