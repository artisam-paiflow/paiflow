// Regression: a lost send acknowledgement must retain the original financial evidence.
// RPC, persistence, audit and event transport are isolated; outcome transitions run for real.
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { Deployment } from "@prisma/client";
import {
  Account,
  Address,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
} from "@stellar/stellar-sdk";

const m = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  history: [] as string[],
  acceptedHash: null as string | null,
  finalAt: Infinity,
  mode: "timeout",
  rpc: { getTransaction: vi.fn(), sendTransaction: vi.fn() },
  refresh: vi.fn(),
  ingest: vi.fn(),
  pollEvents: vi.fn(),
  audit: vi.fn(),
  warn: vi.fn(),
  invalidate: vi.fn(),
  rate: vi.fn(),
  seen: [] as string[],
}));
const db = vi.hoisted(() => ({
  signedTransaction: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  walletControlIntent: { findFirst: vi.fn() },
  webhookAttempt: { findFirst: vi.fn(), updateMany: vi.fn() },
  contractEvent: { findFirst: vi.fn() },
  auditLog: { findFirst: vi.fn() },
  deployment: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/analytics/outbox", () => ({ enqueueAnalytics: vi.fn(async () => true) }));
vi.mock("@/lib/api/v1/events-freshness", () => ({ refreshEventsIfStale: m.refresh }));
vi.mock("@/lib/log", () => ({ log: { warn: m.warn, info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => m.rpc }));
vi.mock("@/lib/stellar/dashboard-balance-cache", () => ({
  invalidateDashboardBalances: m.invalidate,
}));
vi.mock("@/lib/api/v1/auth", () => ({
  apiTokenKey: () => "isolated-token",
  signedTokenAttribution: () => ({ developerApiTokenId: "isolated-token" }),
}));
vi.mock("@/lib/audit", () => ({ audit: m.audit, wasTxConfirmedFor: vi.fn(async () => false) }));
vi.mock("@/lib/api/v1/wait-slots", () => ({ acquireWaitSlot: vi.fn() }));
vi.mock("@/lib/api/v1/execute", () => ({
  ingestEventsBounded: m.ingest,
  waitForFinal: vi.fn(),
  explainFailedTx: vi.fn(async () => ({ code: "ONCHAIN_FAILED", message: "rejected fixture" })),
}));
vi.mock("@/lib/stellar/events", () => ({ pollEventsFor: m.pollEvents }));
vi.mock("@/lib/api/v1/control-intent", () => ({
  recordControlFinality: vi.fn(),
  repairControlAdmission: vi.fn(),
}));
vi.mock("@/lib/stellar/transaction-attribution", () => ({ invokesPipeline: vi.fn(() => true) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rate, rateLimitedError: vi.fn() }));
vi.mock("@/lib/signed-tx", () => ({
  recordSignedTransaction: vi.fn(async ({ signer, network, deploymentId }) => {
    if (m.row) return;
    m.row = {
      id: "mock-signed-row",
      txHash: signer.txHash,
      signerAddress: signer.signerAddress,
      network,
      deploymentId,
      kind: "API_EXECUTE",
      trackingVersion: TRACKING_VERSION,
      audience: "UNCLASSIFIED",
      outcome: "RECEIVED",
      acceptedAt: null,
      ledger: null,
      failureCode: null,
      submissionRevision: 0,
      outcomeRevision: 0,
      developerApiTokenId: "isolated-token",
    };
    m.history.push("RECEIVED");
  }),
}));

import { submitPreparedDeposit } from "@/lib/stellar/submit-deposit";
import { getTransactionStatus } from "@/lib/api/v1/transaction-status";
import { AppError } from "@/lib/errors";
import { TRACKING_VERSION } from "@/lib/analytics/policy";

const id = "11111111-1111-4111-8111-111111111111";
const trigger = StrKey.encodeContract(Buffer.alloc(32, 1));
const deployment = {
  id,
  network: "testnet",
  ownerId: "mock-owner",
  pipelineSnapshot: [
    { nodeId: "trigger", templateKind: "DEPOSIT_TRIGGER", contractAddress: trigger },
  ],
};
const configuredTimeoutMs = 10_000;
const networkDenied = vi.fn(() => {
  throw new Error("Unexpected real network request in isolated fixture");
});
let tx: ReturnType<TransactionBuilder["build"]>;
function snapshot() {
  return m.row ? { ...m.row } : null;
}
beforeEach(() => {
  vi.stubGlobal("fetch", networkDenied);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T01:15:48Z"));
  vi.clearAllMocks();
  m.row = null;
  m.history = [];
  m.acceptedHash = null;
  m.finalAt = Infinity;
  m.mode = "timeout";
  m.seen = [];
  const signer = Keypair.random();
  tx = new TransactionBuilder(new Account(signer.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: trigger,
        function: "deposit",
        args: [
          new Address(signer.publicKey()).toScVal(),
          nativeToScVal(10000000n, { type: "i128" }),
        ],
      }),
    )
    .setTimeout(180)
    .build();
  tx.sign(signer);
  db.signedTransaction.findUnique.mockImplementation(async () => snapshot());
  db.signedTransaction.findFirst.mockImplementation(async () => snapshot());
  db.signedTransaction.update.mockImplementation(async ({ data }) => {
    m.row!.submissionRevision =
      Number(m.row!.submissionRevision) + data.submissionRevision.increment;
    return snapshot();
  });
  db.signedTransaction.updateMany.mockImplementation(async ({ where, data }) => {
    if (!m.row || Object.entries(where).some(([k, v]) => m.row![k] !== v)) return { count: 0 };
    for (const [k, v] of Object.entries(data)) if (v !== undefined) m.row[k] = v;
    if (data.outcome) m.history.push(data.outcome);
    return { count: 1 };
  });
  db.walletControlIntent.findFirst.mockResolvedValue(null);
  db.webhookAttempt.findFirst.mockResolvedValue(null);
  db.contractEvent.findFirst.mockResolvedValue(null);
  db.auditLog.findFirst.mockResolvedValue(null);
  db.deployment.findUnique.mockResolvedValue({ flowId: "mock-flow" });
  db.$transaction.mockImplementation(async (fn) => fn(db));
  m.rate.mockResolvedValue({ ok: true, shared: true });
  m.audit.mockResolvedValue(undefined);
  m.rpc.getTransaction.mockImplementation(async (hash) => {
    m.seen.push(hash);
    if (m.mode === "preflight-failure")
      throw Object.assign(new Error("fixture timeout"), {
        name: "AxiosError",
        code: "ECONNABORTED",
      });
    return hash === m.acceptedHash && Date.now() >= m.finalAt
      ? { status: "SUCCESS", ledger: 5252516 }
      : { status: "NOT_FOUND" };
  });
  m.rpc.sendTransaction.mockImplementation(async (transaction) => {
    if (m.mode === "rejection")
      return { status: "TRY_AGAIN_LATER", hash: transaction.hash().toString("hex") };
    m.acceptedHash = transaction.hash().toString("hex");
    m.finalAt = Date.now() + 19000;
    return new Promise((_resolve, reject) =>
      setTimeout(
        () =>
          reject(
            Object.assign(new Error("timeout of 10000 ms exceeded"), {
              name: "AxiosError",
              code: "ECONNABORTED",
              config: {
                timeout: configuredTimeoutMs,
                data: transaction.toXDR(),
                headers: { authorization: "fixture-private-header" },
              },
            }),
          ),
        configuredTimeoutMs,
      ),
    );
  });
});
afterEach(() => {
  expect(networkDenied).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function submit() {
  return submitPreparedDeposit({
    tx,
    wait: false,
    tokenId: "mock-token",
    tokenType: "developer_token",
    deploymentId: id,
    deployment,
    nodes: deployment.pipelineSnapshot,
    ip: "127.0.0.1",
  });
}

describe("uncertain deposit submission recovery", () => {
  it("sends once, retains unknown finality, then recovers the original hash without another payment", async () => {
    const hash = tx.hash().toString("hex");
    const original = tx.toXDR();
    const request = submit().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(configuredTimeoutMs);
    const error = await request;
    expect(error).toBeInstanceOf(AppError);
    if (!(error instanceof AppError)) throw error;
    expect(error.code).toBe("UPSTREAM_RPC");
    expect(error.message).toContain(hash);
    expect(error.message).toContain("do not prepare or sign another payment");
    expect(m.row!.outcome).toBe("UNRESOLVED");
    expect(m.row!.failureCode).toBe("RPC_UNAVAILABLE");
    expect(m.row!.acceptedAt).toBeNull();
    // No hidden second ten-second RPC call is added to the failed submit request.
    expect(m.rpc.getTransaction).toHaveBeenCalledTimes(1);
    expect(m.rpc.sendTransaction).toHaveBeenCalledTimes(1);
    const pending = await getTransactionStatus(deployment as unknown as Deployment, hash);
    expect(pending.status).toBe("UNKNOWN");
    await vi.advanceTimersByTimeAsync(9_000);
    const recovered = await getTransactionStatus(deployment as unknown as Deployment, hash);
    expect(recovered).toMatchObject({ txHash: hash, status: "SUCCESS", ledger: 5252516 });
    expect(m.history).toEqual(["RECEIVED", "UNRESOLVED", "CONFIRMED"]);
    expect(m.row!.submissionRevision).toBe(1);
    expect(m.row!.failureCode).toBeNull();
    expect(m.rpc.sendTransaction).toHaveBeenCalledTimes(1);
    expect(new Set(m.seen)).toEqual(new Set([hash]));
    expect(tx.toXDR() === original).toBe(true);
    expect(m.refresh).toHaveBeenCalledWith(id, 5252516);
    const count = m.rpc.getTransaction.mock.calls.length;
    expect((await getTransactionStatus(deployment as unknown as Deployment, hash)).status).toBe(
      "SUCCESS",
    );
    expect(m.rpc.getTransaction).toHaveBeenCalledTimes(count);
    const warnings = JSON.stringify(m.warn.mock.calls);
    expect(warnings.includes(original)).toBe(false);
    expect(warnings.includes("fixture-private-header")).toBe(false);
    expect(m.warn.mock.calls[0]?.[0]).toMatchObject({
      stage: "send",
      code: "ECONNABORTED",
      txHash: hash,
    });
  });

  it("keeps an explicit queue refusal separate from an uncertain send", async () => {
    m.mode = "rejection";
    const error = await submit().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect(m.row!.outcome).toBe("REJECTED");
    expect(m.row!.failureCode).toBe("RPC_REJECTED");
    expect(m.acceptedHash).toBeNull();
    expect(
      (await getTransactionStatus(deployment as unknown as Deployment, tx.hash().toString("hex")))
        .status,
    ).toBe("REJECTED");
    expect(m.rpc.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("never sends when the preflight lookup fails", async () => {
    m.mode = "preflight-failure";
    const error = await submit().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    if (!(error instanceof AppError)) throw error;
    expect(error.code).toBe("UPSTREAM_RPC");
    expect(error.message).toContain("original transaction status lookup");
    expect(m.rpc.sendTransaction).not.toHaveBeenCalled();
    expect(m.row!.submissionRevision).toBe(0);
    expect(m.row!.outcome).toBe("UNRESOLVED");
    expect(m.warn.mock.calls[0]?.[0]).toMatchObject({ stage: "preflight" });
  });
});
