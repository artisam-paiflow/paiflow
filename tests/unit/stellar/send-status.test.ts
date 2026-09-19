/**
 * #557: `sendTransaction` answers PENDING | DUPLICATE | TRY_AGAIN_LATER | ERROR,
 * and only the first two put the hash in the network's queue. Everything that
 * sends used to check for ERROR alone, so TRY_AGAIN_LATER read as PENDING and
 * the caller polled a hash that never existed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, TransactionBuilder, Networks, type Transaction } from "@stellar/stellar-sdk";

const { mockRpc, mockInvoke, RELAYER } = vi.hoisted(() => ({
  mockRpc: { getTransaction: vi.fn(), sendTransaction: vi.fn() },
  mockInvoke: { prepareWebhookExecuteInvocation: vi.fn() },
  RELAYER: { secret: "", address: "" },
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => mockRpc,
  horizon: vi.fn(),
  withRelayerLock: <T>(fn: () => Promise<T>) => fn(),
}));
vi.mock("@/lib/stellar/invoke", () => mockInvoke);
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  stellarRelayerSecretKey: () => RELAYER.secret,
  stellarRelayerAddress: () => RELAYER.address,
}));

import { AppError } from "@/lib/errors";
import { submitDeployTx } from "@/lib/stellar/deploy";
import { classifySend, SEND_NOT_ACCEPTED_MESSAGE } from "@/lib/stellar/send-status";
import { submitTriggerTx, submitWebhookExecuteTx } from "@/lib/stellar/trigger";
import { TRIGGER, signedEnvelope } from "../api/v1/execute-fixtures";

const hashOf = (signed: string) =>
  (TransactionBuilder.fromXDR(signed, Networks.TESTNET) as Transaction).hash().toString("hex");

beforeEach(() => {
  vi.clearAllMocks();
  const relayer = Keypair.random();
  RELAYER.secret = relayer.secret();
  RELAYER.address = relayer.publicKey();
  mockInvoke.prepareWebhookExecuteInvocation.mockResolvedValue({ tx: { sign: vi.fn() } });
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
    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "h" });
    expect(await submitWebhookExecuteTx(opts)).toEqual({
      status: "PENDING",
      txHash: "h",
      duplicate: false,
    });

    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "DUPLICATE", hash: "h" });
    expect(await submitWebhookExecuteTx(opts)).toEqual({
      status: "PENDING",
      txHash: "h",
      duplicate: true,
    });
  });
});

describe("submitDeployTx", () => {
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
