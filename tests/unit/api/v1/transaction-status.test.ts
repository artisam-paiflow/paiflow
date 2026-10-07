import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Account,
  Contract,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  Asset,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  signed: vi.fn(),
  attempt: vi.fn(),
  updateAttempt: vi.fn(),
  event: vi.fn(),
  audit: vi.fn(),
  token: vi.fn(),
  updateToken: vi.fn(),
  rpc: vi.fn(),
  outcome: vi.fn(),
  budget: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    signedTransaction: { findFirst: mocks.signed },
    webhookAttempt: { findFirst: mocks.attempt, updateMany: mocks.updateAttempt },
    contractEvent: { findFirst: mocks.event },
    auditLog: { findFirst: mocks.audit },
    deploymentApiToken: { findUnique: mocks.token, update: mocks.updateToken },
  },
}));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  rateLimit: mocks.budget,
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => ({ getTransaction: mocks.rpc }) }));
vi.mock("@/lib/analytics/outcomes", () => ({ recordTransactionOutcome: mocks.outcome }));
import { getTransactionStatus } from "@/lib/api/v1/transaction-status";
import { invokesPipeline } from "@/lib/stellar/transaction-attribution";
import { env } from "@/lib/env";
import { TransactionStatusSchema } from "@/lib/api/v1/schema";
import { GET } from "@/app/api/v1/deployments/[id]/transactions/[txHash]/route";
const id = "6b1f0c52-3d4e-4a8b-9c7d-2e5f8a1b3c4d";
const hash = "a".repeat(64);
const contract = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const deployment = {
  id,
  network: "testnet",
  pipelineSnapshot: [{ contractAddress: contract }],
} as unknown as Deployment;
const received = { outcome: "RECEIVED", acceptedAt: null, ledger: null, failureCode: null };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.signed.mockResolvedValue(received);
  mocks.attempt.mockResolvedValue(null);
  mocks.updateAttempt.mockResolvedValue({ count: 1 });
  mocks.event.mockResolvedValue(null);
  mocks.audit.mockResolvedValue(null);
  mocks.rpc.mockResolvedValue({ status: "NOT_FOUND" });
  mocks.outcome.mockResolvedValue(false);
  mocks.budget.mockResolvedValue({ ok: true, shared: true });
  mocks.updateToken.mockResolvedValue({});
});
describe("deployment transaction lookup", () => {
  it("attributes keyed webhooks without audit records and preserves their hash", async () => {
    mocks.signed.mockResolvedValue(null);
    mocks.attempt.mockResolvedValue({ id: "attempt", status: "PENDING", acceptedAt: new Date() });
    expect((await getTransactionStatus(deployment, hash)).status).toBe("PENDING");
    expect(mocks.attempt).toHaveBeenCalledWith({
      where: { deploymentId: id, network: "testnet", txHash: hash },
    });
  });
  it("does not let an older refusal override accepted webhook evidence", async () => {
    mocks.signed.mockResolvedValue({ ...received, outcome: "REJECTED" });
    mocks.attempt.mockResolvedValue({ id: "attempt", status: "PENDING", acceptedAt: new Date() });
    expect((await getTransactionStatus(deployment, hash)).status).toBe("PENDING");
  });
  it.each(["SUCCESS", "FAILED"])(
    "retains a keyed webhook's %s across RPC expiry",
    async (status) => {
      mocks.attempt.mockResolvedValue({ status, ledger: 12 });
      expect((await getTransactionStatus(deployment, hash)).status).toBe(status);
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it("reconciles a keyed webhook's finality to its reserved attempt", async () => {
    mocks.signed.mockResolvedValue(null);
    mocks.attempt.mockResolvedValue({ id: "attempt", status: "UNKNOWN", acceptedAt: null });
    mocks.rpc.mockResolvedValue({ status: "SUCCESS", ledger: 12 });
    expect((await getTransactionStatus(deployment, hash)).status).toBe("SUCCESS");
    expect(mocks.updateAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "attempt", status: { notIn: ["SUCCESS", "FAILED"] } },
        data: { status: "SUCCESS", ledger: 12, errorCode: null },
      }),
    );
  });
  it.each([false, true])(
    "preserves a concurrent keyed confirmation after stale RPC, throws=%s",
    async (throws) => {
      mocks.signed.mockResolvedValue(null);
      mocks.attempt
        .mockResolvedValueOnce({ id: "attempt", status: "UNKNOWN" })
        .mockResolvedValue({ id: "attempt", status: "SUCCESS", ledger: 12 });
      if (throws) mocks.rpc.mockRejectedValue(new Error("RPC down"));
      expect((await getTransactionStatus(deployment, hash)).status).toBe("SUCCESS");
    },
  );
  it("does not turn an attributed but unobserved attempt into pending or failure", async () => {
    expect(await getTransactionStatus(deployment, hash)).toEqual({
      txHash: hash,
      network: "testnet",
      status: "UNKNOWN",
    });
  });
  it("retains positive acceptance across observation gaps", async () => {
    mocks.signed.mockResolvedValue({ ...received, outcome: "UNRESOLVED", acceptedAt: new Date() });
    expect((await getTransactionStatus(deployment, hash)).status).toBe("PENDING");
  });
  it("supports queued webhook audit attribution", async () => {
    mocks.signed.mockResolvedValue(null);
    mocks.audit.mockResolvedValue({ action: "DEPLOY_TRIGGER" });
    expect((await getTransactionStatus(deployment, hash)).status).toBe("PENDING");
  });
  it("allows early-release audit attribution but cannot infer missing historical finality", async () => {
    mocks.signed.mockResolvedValue(null);
    mocks.audit.mockResolvedValue({ action: "API_TIMELOCK_RELEASE_BEFORE" });
    expect((await getTransactionStatus(deployment, hash)).status).toBe("UNKNOWN");
  });
  it("returns retained terminal evidence without RPC", async () => {
    mocks.signed.mockResolvedValue({ ...received, outcome: "CONFIRMED", ledger: 12 });
    expect(await getTransactionStatus(deployment, hash)).toMatchObject({
      status: "SUCCESS",
      ledger: 12,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("retains FAILED with structured details without RPC", async () => {
    mocks.signed.mockResolvedValue({ ...received, outcome: "FAILED", ledger: 12 });
    expect(await getTransactionStatus(deployment, hash)).toMatchObject({
      status: "FAILED",
      ledger: 12,
      error: { code: "ONCHAIN_FAILED" },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("fails closed when production loses the shared RPC budget", async () => {
    const config = env();
    const previous = config.NODE_ENV;
    config.NODE_ENV = "production";
    try {
      mocks.budget.mockResolvedValue({ ok: true, shared: false });
      await expect(getTransactionStatus(deployment, hash)).rejects.toMatchObject({
        code: "UPSTREAM_RPC",
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
    } finally {
      config.NODE_ENV = previous;
    }
  });
  it("uses retained event evidence", async () => {
    mocks.signed.mockResolvedValue(null);
    mocks.event.mockResolvedValue({ ledger: 12 });
    expect((await getTransactionStatus(deployment, hash)).status).toBe("SUCCESS");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["SUCCESS", "FAILED"])("reconciles only scoped %s evidence", async (status) => {
    mocks.rpc.mockResolvedValue({ status, ledger: 12 });
    expect(await getTransactionStatus(deployment, hash)).toMatchObject({ status, ledger: 12 });
    expect(mocks.outcome).toHaveBeenCalledWith(
      hash,
      status === "SUCCESS" ? "CONFIRMED" : "FAILED",
      expect.objectContaining({ deploymentId: id, executionOnly: true }),
    );
    expect(mocks.signed).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deploymentId: id, network: "testnet", txHash: hash, kind: { not: "DEPLOY" } },
      }),
    );
  });
  it("refuses unrelated and unobserved hashes with the same generic 404", async () => {
    mocks.signed.mockResolvedValue(null);
    for (const result of [{ status: "NOT_FOUND" }, { status: "SUCCESS", ledger: 12 }]) {
      mocks.rpc.mockResolvedValue(result);
      await expect(getTransactionStatus(deployment, hash)).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Transaction not available for this deployment",
      });
    }
    expect(mocks.outcome).not.toHaveBeenCalled();
  });
  it("reports RPC outages as retryable lookup errors", async () => {
    mocks.rpc.mockRejectedValue(new Error("down"));
    await expect(getTransactionStatus(deployment, hash)).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
    });
    expect(mocks.outcome).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "preserves concurrent confirmation after stale read, RPC throws=%s",
    async (throws) => {
      mocks.signed
        .mockResolvedValueOnce(received)
        .mockResolvedValue({ ...received, outcome: "CONFIRMED", ledger: 12 });
      if (throws) mocks.rpc.mockRejectedValue(new Error("down"));
      expect((await getTransactionStatus(deployment, hash)).status).toBe("SUCCESS");
    },
  );
  it("propagates database outages without claiming uncertainty", async () => {
    mocks.signed.mockRejectedValue(new Error("DB down"));
    await expect(getTransactionStatus(deployment, hash)).rejects.toThrow("DB down");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("distinguishes a submission rejection from an on-chain failure", async () => {
    mocks.signed.mockResolvedValue({ ...received, outcome: "REJECTED" });
    expect((await getTransactionStatus(deployment, hash)).status).toBe("REJECTED");
  });
  it("bounds RPC work across tokens", async () => {
    mocks.budget.mockResolvedValue({ ok: false, shared: true, resetAt: Date.now() + 5000 });
    await expect(getTransactionStatus(deployment, hash)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses a deployment on another network before reading records", async () => {
    await expect(
      getTransactionStatus({ ...deployment, network: "mainnet" }, hash),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.signed).not.toHaveBeenCalled();
  });
});
describe("outside-submission attribution", () => {
  const key = Keypair.random();
  const tx = new TransactionBuilder(new Account(key.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(new Contract(contract).call("deposit"))
    .setTimeout(180)
    .build();
  it("requires a direct pipeline invocation and pinned-network hash", () => {
    expect(
      invokesPipeline(tx.toXDR(), tx.hash().toString("hex"), deployment.pipelineSnapshot),
    ).toBe(true);
    expect(invokesPipeline(tx.toXDR(), hash, deployment.pipelineSnapshot)).toBe(false);
    expect(invokesPipeline(tx.toXDR(), tx.hash().toString("hex"), [])).toBe(false);
    expect(invokesPipeline("garbage", hash, deployment.pipelineSnapshot)).toBe(false);
    const mainnet = TransactionBuilder.fromXDR(tx.toXDR(), Networks.PUBLIC);
    expect(
      invokesPipeline(tx.toXDR(), mainnet.hash().toString("hex"), deployment.pipelineSnapshot),
    ).toBe(false);
  });
  it("does not attribute an ordinary token payment", () => {
    const payment = new TransactionBuilder(new Account(key.publicKey(), "1"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({ destination: key.publicKey(), asset: Asset.native(), amount: "1" }),
      )
      .setTimeout(180)
      .build();
    expect(
      invokesPipeline(payment.toXDR(), payment.hash().toString("hex"), deployment.pipelineSnapshot),
    ).toBe(false);
  });
  it("uses the outer hash and inner invocation for fee bumps", () => {
    const bump: FeeBumpTransaction = TransactionBuilder.buildFeeBumpTransaction(
      key,
      "100",
      tx,
      Networks.TESTNET,
    );
    expect(
      invokesPipeline(bump.toXDR(), bump.hash().toString("hex"), deployment.pipelineSnapshot),
    ).toBe(true);
    expect(
      invokesPipeline(bump.toXDR(), tx.hash().toString("hex"), deployment.pipelineSnapshot),
    ).toBe(false);
  });
  it("can return attributed outside success", async () => {
    mocks.signed.mockResolvedValue(null);
    mocks.rpc.mockResolvedValue({ status: "SUCCESS", ledger: 12, envelopeXdr: tx.toXDR() });
    expect((await getTransactionStatus(deployment, tx.hash().toString("hex"))).status).toBe(
      "SUCCESS",
    );
  });
});
describe("token-only route", () => {
  const call = (token?: string, txHash = hash) =>
    GET(
      new NextRequest(`http://localhost/api/v1/deployments/${id}/transactions/${txHash}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
      { params: Promise.resolve({ id, txHash }) },
    );
  it("refuses missing credentials without RPC or record reads", async () => {
    expect((await call()).status).toBe(401);
    expect(mocks.signed).not.toHaveBeenCalled();
  });
  it("refuses a token bound to another deployment", async () => {
    mocks.token.mockResolvedValue({
      deploymentId: "other",
      deployment: { owner: { isActive: true } },
    });
    expect((await call(`pfk_${"b".repeat(64)}`)).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("shares one token limit across distinct hash paths", async () => {
    const token = `pfk_${"d".repeat(64)}`;
    mocks.token.mockResolvedValue({
      id: "distinct-hash-token",
      deploymentId: id,
      expiresAt: null,
      deployment: { ...deployment, owner: { isActive: true, role: "USER" } },
    });
    mocks.signed.mockResolvedValue({ ...received, outcome: "CONFIRMED", ledger: 12 });
    for (let index = 0; index < 60; index++) {
      expect((await call(token, index.toString(16).padStart(64, "0"))).status).toBe(200);
    }
    const refused = await call(token, "f".repeat(64));
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(mocks.signed).toHaveBeenCalledTimes(60);
  });
  it("validates hash after authenticating and normalizes uppercase", async () => {
    mocks.token.mockResolvedValue({
      id: "token",
      deploymentId: id,
      expiresAt: null,
      deployment: { ...deployment, owner: { isActive: true, role: "USER" } },
    });
    const token = `pfk_${"c".repeat(64)}`;
    expect((await call(token, "invalid")).status).toBe(422);
    const res = await call(token, hash.toUpperCase());
    expect(res.status).toBe(200);
    expect((await res.json()).data.txHash).toBe(hash);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("transaction status response schema", () => {
  it.each(["SUCCESS", "FAILED", "PENDING", "UNKNOWN", "REJECTED"])(
    "accepts %s with canonical identifiers",
    (status) => {
      expect(
        TransactionStatusSchema.safeParse({ txHash: hash, network: "testnet", status }).success,
      ).toBe(true);
    },
  );
  it.each([
    { txHash: "bad" },
    { network: "other" },
    { status: "NOT_FOUND" },
    { ledger: -1 },
    { error: { code: "FAILED" } },
  ])("refuses invalid public responses %j", (override) => {
    expect(
      TransactionStatusSchema.safeParse({
        txHash: hash,
        network: "testnet",
        status: "UNKNOWN",
        ...override,
      }).success,
    ).toBe(false);
  });
});
