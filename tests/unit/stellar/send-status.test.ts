/**
 * #557: `sendTransaction` answers PENDING | DUPLICATE | TRY_AGAIN_LATER | ERROR,
 * and only the first two put the hash in the network's queue. Everything that
 * sends used to check for ERROR alone, so TRY_AGAIN_LATER read as PENDING and
 * the caller polled a hash that never existed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, TransactionBuilder, Networks, type Transaction } from "@stellar/stellar-sdk";

const { mockRpc, mockInvoke, mockChannels, RELAYER } = vi.hoisted(() => ({
  mockRpc: { getTransaction: vi.fn(), sendTransaction: vi.fn() },
  mockInvoke: { webhookExecuteOperation: vi.fn(), webhookEscrowOperation: vi.fn() },
  mockChannels: { buildRelayerTx: vi.fn(), trackPending: vi.fn() },
  RELAYER: { secret: "", address: "" },
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/analytics/outcomes", () => ({
  recordTransactionOutcome: vi.fn(async () => false),
  beginTransactionSubmission: vi.fn(async () => undefined),
  transactionObservation: vi.fn(async () => undefined),
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => mockRpc,
  horizon: vi.fn(),
  withRelayerLock: <T>(fn: () => Promise<T>) => fn(),
}));
vi.mock("@/lib/stellar/invoke", () => mockInvoke);
vi.mock("@/lib/stellar/relayer-channels", () => ({
  withRelayerChannel: <T>(fn: (channel: unknown) => Promise<T>) =>
    fn({ trackPending: mockChannels.trackPending }),
  buildRelayerTx: mockChannels.buildRelayerTx,
}));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  stellarRelayerSecretKey: () => RELAYER.secret,
  stellarRelayerAddress: () => RELAYER.address,
}));

import { AppError } from "@/lib/errors";
import { submitDeployTx } from "@/lib/stellar/deploy";
import { recordTransactionOutcome, transactionObservation } from "@/lib/analytics/outcomes";
import { classifySend, SEND_NOT_ACCEPTED_MESSAGE } from "@/lib/stellar/send-status";
import { submitTriggerTx, submitWebhookExecuteTx } from "@/lib/stellar/trigger";
import { TRIGGER, signedEnvelope } from "../api/v1/execute-fixtures";

const hashOf = (signed: string) =>
  (TransactionBuilder.fromXDR(signed, Networks.TESTNET) as Transaction).hash().toString("hex");
let webhookTx: Transaction;

beforeEach(() => {
  vi.clearAllMocks();
  const relayer = Keypair.random();
  RELAYER.secret = relayer.secret();
  RELAYER.address = relayer.publicKey();
  mockInvoke.webhookExecuteOperation.mockReturnValue({});
  webhookTx = TransactionBuilder.fromXDR(signedEnvelope(), Networks.TESTNET) as Transaction;
  mockChannels.buildRelayerTx.mockResolvedValue(webhookTx);
});

describe("classifySend", () => {
  it.each([
    ["PENDING", { outcome: "QUEUED", duplicate: false }],
    ["DUPLICATE", { outcome: "QUEUED", duplicate: true }],
    ["TRY_AGAIN_LATER", { outcome: "NOT_ACCEPTED" }],
    ["ERROR", { outcome: "REJECTED" }],
  ] as const)("%s", (status, expected) => {
    expect(classifySend({ status })).toEqual(expected);
  });

  it("refuses a status it does not know rather than reading it as queued", () => {
    const send = { status: "SOMETHING_NEW" } as unknown as Parameters<typeof classifySend>[0];
    expect(() => classifySend(send)).toThrowError(AppError);
    expect(() => classifySend(send)).toThrowError(/unknown send status/);
  });
});

describe("submitTriggerTx", () => {
  it("TRY_AGAIN_LATER throws UPSTREAM_RPC instead of answering PENDING", async () => {
    const signed = signedEnvelope();
    mockRpc.sendTransaction.mockResolvedValue({ status: "TRY_AGAIN_LATER", hash: hashOf(signed) });

    await expect(submitTriggerTx(signed)).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
      message: SEND_NOT_ACCEPTED_MESSAGE,
    });
  });

  it("DUPLICATE is PENDING, flagged so the caller writes no second audit row", async () => {
    const signed = signedEnvelope();
    mockRpc.sendTransaction.mockResolvedValue({ status: "DUPLICATE", hash: hashOf(signed) });

    expect(await submitTriggerTx(signed)).toMatchObject({
      status: "PENDING",
      txHash: hashOf(signed),
      duplicate: true,
    });
  });

  it("PENDING is not flagged as a duplicate", async () => {
    const signed = signedEnvelope();
    mockRpc.sendTransaction.mockResolvedValue({ status: "PENDING", hash: hashOf(signed) });

    expect(await submitTriggerTx(signed)).toMatchObject({ status: "PENDING", duplicate: false });
  });

  it("ERROR is still a FAILED result carrying the hash", async () => {
    const signed = signedEnvelope();
    mockRpc.sendTransaction.mockResolvedValue({ status: "ERROR", hash: hashOf(signed) });

    const result = await submitTriggerTx(signed);

    expect(result.status).toBe("FAILED");
    expect(result.txHash).toBe(hashOf(signed));
    expect(result.errorMessage).toContain("sendTransaction error");
  });
});

describe("submitWebhookExecuteTx", () => {
  const opts = { contractAddress: TRIGGER, from: Keypair.random().publicKey(), amount: "10000000" };

  it("TRY_AGAIN_LATER throws UPSTREAM_RPC and is not retried under the relayer lock", async () => {
    mockRpc.sendTransaction.mockResolvedValue({ status: "TRY_AGAIN_LATER", hash: "h" });

    await expect(submitWebhookExecuteTx(opts)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    expect(mockRpc.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("PENDING and DUPLICATE are both PENDING, told apart by the flag", async () => {
    const hash = webhookTx.hash().toString("hex");
    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash });
    expect(await submitWebhookExecuteTx(opts)).toEqual({
      status: "PENDING",
      txHash: hash,
      duplicate: false,
    });
    // The channel is told about the unfinished transaction, so its next holder waits for it.
    expect(mockChannels.trackPending).toHaveBeenCalledWith(hash, webhookTx.timeBounds?.maxTime);

    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "DUPLICATE", hash });
    expect(await submitWebhookExecuteTx(opts)).toEqual({
      status: "PENDING",
      txHash: hash,
      duplicate: true,
    });
  });
});

describe("submitDeployTx", () => {
  it.each(["PENDING", "DUPLICATE"])(
    "rehearsal records %s acceptance and leaves finality to cron",
    async (status) => {
      const signed = signedEnvelope();
      mockRpc.sendTransaction.mockResolvedValue({ status, hash: hashOf(signed) });
      expect(await submitDeployTx(signed, { confirmation: "reconcile" })).toEqual({
        status: "SUBMITTED",
        txHash: hashOf(signed),
      });
      expect(recordTransactionOutcome).toHaveBeenCalledWith(
        hashOf(signed),
        "ACCEPTED",
        expect.any(Object),
      );
      expect(transactionObservation).not.toHaveBeenCalled();
      expect(mockRpc.getTransaction).not.toHaveBeenCalled();
    },
  );
  it.each(["TRY_AGAIN_LATER", "ERROR"])("rehearsal does not call %s accepted", async (status) => {
    const signed = signedEnvelope();
    mockRpc.sendTransaction.mockResolvedValue({ status, hash: hashOf(signed) });
    const result = await submitDeployTx(signed, { confirmation: "reconcile" });
    expect(result.status).toBe(status === "ERROR" ? "FAILED" : "NOT_ACCEPTED");
    expect(recordTransactionOutcome).not.toHaveBeenCalledWith(
      hashOf(signed),
      "ACCEPTED",
      expect.any(Object),
    );
    expect(mockRpc.getTransaction).not.toHaveBeenCalled();
  });
  it("leaves ambiguous send errors unresolved during the rehearsal", async () => {
    const signed = signedEnvelope();
    mockRpc.sendTransaction.mockRejectedValueOnce(new Error("RPC unavailable"));
    await expect(submitDeployTx(signed, { confirmation: "reconcile" })).rejects.toThrow(
      "RPC unavailable",
    );
    expect(recordTransactionOutcome).toHaveBeenCalledWith(
      hashOf(signed),
      "UNRESOLVED",
      expect.objectContaining({ failureCode: "RPC_UNAVAILABLE" }),
    );
    expect(mockRpc.getTransaction).not.toHaveBeenCalled();
  });
  it("TRY_AGAIN_LATER answers NOT_ACCEPTED at once, without polling the unqueued hash", async () => {
    const signed = signedEnvelope();
    mockRpc.sendTransaction.mockResolvedValue({ status: "TRY_AGAIN_LATER", hash: hashOf(signed) });

    expect(await submitDeployTx(signed)).toEqual({ status: "NOT_ACCEPTED" });
    expect(mockRpc.getTransaction).not.toHaveBeenCalled();
  });

  it("DUPLICATE is already queued, so it is polled to finality like a first send", async () => {
    const signed = signedEnvelope();
    mockRpc.sendTransaction.mockResolvedValue({ status: "DUPLICATE", hash: hashOf(signed) });
    mockRpc.getTransaction.mockResolvedValue({ status: "SUCCESS" });

    expect(await submitDeployTx(signed)).toMatchObject({
      status: "SUCCESS",
      txHash: hashOf(signed),
    });
    expect(mockRpc.getTransaction).toHaveBeenCalledWith(hashOf(signed));
  });

  it("ERROR is still FAILED without polling", async () => {
    const signed = signedEnvelope();
    mockRpc.sendTransaction.mockResolvedValue({ status: "ERROR", hash: hashOf(signed) });

    expect(await submitDeployTx(signed)).toMatchObject({
      status: "FAILED",
      txHash: hashOf(signed),
    });
    expect(mockRpc.getTransaction).not.toHaveBeenCalled();
  });
});
