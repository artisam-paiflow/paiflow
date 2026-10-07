import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Deployment, WebhookAttempt } from "@prisma/client";
const m = vi.hoisted(() => ({
  create: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  submit: vi.fn(),
  status: vi.fn(),
  audit: vi.fn(),
  findAudit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    webhookAttempt: { create: m.create, findUniqueOrThrow: m.find, updateMany: m.update },
    auditLog: { upsert: m.audit, findFirst: m.findAudit },
  },
}));
vi.mock("@/lib/stellar/trigger", () => ({ submitWebhookExecuteTx: m.submit }));
vi.mock("@/lib/api/v1/transaction-status", () => ({ getTransactionStatus: m.status }));
import { executeKeyedWebhook, webhookRequestHash } from "@/lib/webhook-idempotency";
import { wasTxSubmittedFor } from "@/lib/audit";
const deployment = { id: "d", network: "testnet", flow: { ownerId: "owner" } } as Deployment & {
  flow: { ownerId: string };
};
const input = { escrow: true, amount: "100" };
const hash = "a".repeat(64);
let rows: Map<string, WebhookAttempt>;
let audits: Map<
  string,
  {
    id: string;
    action: string;
    userId: string;
    metadata: { deploymentId: string; txHash: string; escrow: boolean };
  }
>;
let failHashWrite = false;
let loseHashAck = false;
let failRead = false;
const call = (key = "task-42", body = input, d = deployment) =>
  executeKeyedWebhook(d, "contract", key, body);
beforeEach(() => {
  vi.resetAllMocks();
  rows = new Map();
  audits = new Map();
  m.audit.mockImplementation(async ({ where, create }) => {
    if (!audits.has(where.id)) audits.set(where.id, create);
    return audits.get(where.id);
  });
  m.findAudit.mockImplementation(async ({ where }) => {
    const deploymentId = where.AND[0].metadata.equals;
    const txHash = where.AND[1].metadata.equals;
    return (
      [...audits.values()].find(
        (row) =>
          where.action.in.includes(row.action) &&
          row.metadata.deploymentId === deploymentId &&
          row.metadata.txHash === txHash,
      ) ?? null
    );
  });
  failHashWrite = false;
  loseHashAck = false;
  failRead = false;
  m.create.mockImplementation(async ({ data }) => {
    const key = `${data.deploymentId}:${data.keyHash}`;
    if (rows.has(key)) throw { code: "P2002" };
    const row = {
      ...data,
      txHash: null,
      acceptedAt: null,
      status: "PREPARING",
      ledger: null,
      errorCode: null,
    };
    rows.set(key, row);
    return { ...row };
  });
  m.find.mockImplementation(async ({ where }) => {
    if (failRead) throw new Error("DB unavailable");
    const row = where.id
      ? [...rows.values()].find((r) => r.id === where.id)
      : rows.get(
          `${where.deploymentId_keyHash.deploymentId}:${where.deploymentId_keyHash.keyHash}`,
        );
    if (!row) throw new Error("missing attempt");
    return { ...row };
  });
  m.update.mockImplementation(async ({ where, data }) => {
    if (data.txHash && failHashWrite) throw new Error("write unavailable");
    const row = [...rows.values()].find((r) => r.id === where.id);
    if (
      !row ||
      (typeof where.status === "string" && row.status !== where.status) ||
      (where.status?.in && !where.status.in.includes(row.status)) ||
      (where.status?.notIn && where.status.notIn.includes(row.status)) ||
      (where.txHash === null && row.txHash !== null)
    )
      return { count: 0 };
    Object.assign(row, data);
    if (data.txHash && loseHashAck) throw new Error("acknowledgement lost");
    return { count: 1 };
  });
  m.status.mockResolvedValue({ txHash: hash, network: "testnet", status: "PENDING" });
  m.submit.mockImplementation(async ({ submissionHooks }) => {
    await submissionHooks.beforeSend(hash);
    await submissionHooks.afterSend(true);
    return { status: "PENDING", txHash: hash };
  });
});
describe("durable webhook event keys", () => {
  it("reserves one attempt for concurrent identical callbacks", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => call()));
    expect(new Set(results.map((r) => r.attemptId)).size).toBe(1);
    expect(m.submit).toHaveBeenCalledOnce();
    expect(rows.size).toBe(1);
    await call();
    expect(audits.size).toBe(1);
    expect([...audits.keys()]).toEqual([results[0]!.attemptId]);
  });
  it("records an accepted payout for the owner and enables tx-status bookkeeping", async () => {
    const result = await call();
    expect(audits.get(result.attemptId)).toMatchObject({
      action: "DEPLOY_TRIGGER",
      userId: "owner",
      metadata: { deploymentId: "d", txHash: hash, amount: "100", escrow: true },
    });
    expect(await wasTxSubmittedFor("d", hash)).toBe(true);
    expect(await wasTxSubmittedFor("other", hash)).toBe(false);
  });
  it("repairs an interrupted audit write on concurrent retries without sending again", async () => {
    m.audit.mockRejectedValueOnce(new Error("audit unavailable"));
    const first = await call();
    expect(first.status).toBe("PENDING");
    expect(audits.size).toBe(0);
    await Promise.all(Array.from({ length: 20 }, () => call()));
    expect(audits.size).toBe(1);
    expect(audits.has(first.attemptId)).toBe(true);
    expect(m.submit).toHaveBeenCalledOnce();
  });
  it.each(["SUCCESS", "FAILED"])(
    "repairs a terminal %s attempt's missing audit",
    async (status) => {
      const first = await call();
      audits.clear();
      Object.assign([...rows.values()][0]!, { status });
      await Promise.all([call(), call()]);
      expect(audits.size).toBe(1);
      expect(audits.has(first.attemptId)).toBe(true);
      expect(m.submit).toHaveBeenCalledOnce();
    },
  );
  it("leaves a reserved hash unaudited until chain lookup establishes acceptance", async () => {
    m.submit.mockImplementationOnce(async ({ submissionHooks }) => {
      await submissionHooks.beforeSend(hash);
      throw new Error("transport timeout");
    });
    const first = await call();
    expect(audits.size).toBe(0);
    m.status.mockResolvedValueOnce({ txHash: hash, status: "UNKNOWN" });
    await call();
    expect(audits.size).toBe(0);
    m.status.mockResolvedValueOnce({ txHash: hash, status: "SUCCESS", ledger: 10 });
    await call();
    expect(audits.has(first.attemptId)).toBe(true);
    expect(m.submit).toHaveBeenCalledOnce();
  });
  it("rejects different payloads and keeps the original key", async () => {
    await call();
    await expect(call("task-42", { escrow: true, amount: "200" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(m.submit).toHaveBeenCalledOnce();
  });
  it("scopes identical keys to different deployments", async () => {
    const a = await call();
    const b = await call("task-42", input, { ...deployment, id: "other" });
    expect(a.attemptId).not.toBe(b.attemptId);
    expect(m.submit).toHaveBeenCalledTimes(2);
  });
  it("normalizes effective arguments without retaining bodies or raw keys", async () => {
    expect(webhookRequestHash({ escrow: true })).toBe(
      webhookRequestHash({ escrow: true, amount: "000", from: "ignored" }),
    );
    const result = await call("task-42", { escrow: true, amount: "000100" });
    expect((await call()).attemptId).toBe(result.attemptId);
    const { data } = m.create.mock.calls[0]![0];
    expect(data.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data).not.toHaveProperty("body");
    expect(data).not.toHaveProperty("auth");
  });
  it("reports unknown after a transport failure, and never submits again", async () => {
    m.submit.mockImplementationOnce(async ({ submissionHooks }) => {
      await submissionHooks.beforeSend(hash);
      throw new Error("timeout after acceptance");
    });
    const first = await call();
    expect(first.status).toBe("UNKNOWN");
    expect(first.txHash).toBe(hash);
    m.status.mockResolvedValue({ txHash: hash, status: "SUCCESS", ledger: 10 });
    const retry = await call();
    expect(retry).toMatchObject({
      attemptId: first.attemptId,
      status: "SUCCESS",
      txHash: hash,
      ledger: 10,
    });
    expect((await call()).status).toBe("SUCCESS");
    expect(m.submit).toHaveBeenCalledOnce();
    expect(m.status).toHaveBeenCalledOnce();
  });
  it("does not reopen a worker's pre-hash reservation even after an arbitrary delay", async () => {
    const originalCreate = m.create.getMockImplementation()!;
    m.create.mockImplementationOnce(async (args) => {
      const row = await originalCreate(args);
      throw new Error("lost create acknowledgement");
    });
    await expect(call()).rejects.toThrow();
    const retry = await call();
    expect(retry.status).toBe("UNKNOWN");
    expect(retry).not.toHaveProperty("txHash");
    expect(m.submit).not.toHaveBeenCalled();
  });
  it("fails closed if the hash cannot be persisted", async () => {
    failHashWrite = true;
    const first = await call();
    expect(first.status).toBe("REJECTED");
    expect(audits.size).toBe(0);
    expect(first).not.toHaveProperty("txHash");
    expect((await call()).attemptId).toBe(first.attemptId);
    expect(m.submit).toHaveBeenCalledOnce();
  });
  it("retains a hash whose database acknowledgement was lost, without sending", async () => {
    loseHashAck = true;
    const first = await call();
    expect(first.status).toBe("UNKNOWN");
    expect(first.txHash).toBe(hash);
    await call();
    expect(m.submit).toHaveBeenCalledOnce();
  });
  it("propagates read failures instead of opening another send attempt", async () => {
    await call();
    failRead = true;
    await expect(call()).rejects.toThrow("DB unavailable");
    expect(m.submit).toHaveBeenCalledOnce();
  });
  it("retains submission rejections", async () => {
    m.submit.mockImplementationOnce(async ({ submissionHooks }) => {
      await submissionHooks.beforeSend(hash);
      await submissionHooks.afterSend(false);
      throw new Error("busy");
    });
    const first = await call();
    expect(first.status).toBe("REJECTED");
    expect(audits.size).toBe(0);
    m.status.mockResolvedValue({ txHash: hash, status: "REJECTED" });
    expect((await call()).status).toBe("REJECTED");
    expect(m.submit).toHaveBeenCalledOnce();
  });
  it.each(["", "bad key", "a".repeat(129)])("validates keys before claiming: %j", async (key) => {
    await expect(call(key)).rejects.toThrow();
    expect(m.create).not.toHaveBeenCalled();
  });
  it("refuses a network mismatch before claiming", async () => {
    await expect(call("task", input, { ...deployment, network: "mainnet" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(m.create).not.toHaveBeenCalled();
  });
});
