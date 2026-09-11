/**
 * QA-D1 ISSUE-002: a confirmed trigger must land its contract events in the
 * store before the status response returns, so the deployment page the user
 * opens next renders them without waiting for the cron poller.
 *
 * Also covers the txHash -> deployment binding. The route is public (the
 * `/trigger/:id` page has no session) and reachable by a sandbox identity, so
 * the only thing standing between an arbitrary caller and a `pollEventsFor`
 * run on someone else's deployment is that lookup.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRpc, mockDb } = vi.hoisted(() => ({
  mockRpc: { getTransaction: vi.fn() },
  mockDb: { deployment: { findUnique: vi.fn() }, auditLog: { findFirst: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => mockRpc }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => undefined),
  clientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/stellar/events", () => ({
  pollEventsFor: vi.fn(async () => 1),
  recordAllowanceEvent: vi.fn(async () => undefined),
}));

import { GET } from "@/app/api/deployments/[id]/tx-status/route";
import { pollEventsFor } from "@/lib/stellar/events";

const DEPLOYMENT_ID = "44c3ed53-9b6d-4be0-bade-e5fcc6c7a0eb";
const TX_HASH = "8d8707228a6b1d30b01dd2f5c6d956961f090cd9cd690c73d994f7a8a4ec8f3f";

function call() {
  const req = new Request(
    `http://localhost/api/deployments/${DEPLOYMENT_ID}/tx-status?txHash=${TX_HASH}`,
  );
  return GET(req as unknown as import("next/server").NextRequest, {
    params: Promise.resolve({ id: DEPLOYMENT_ID }),
  });
}

describe("GET /api/deployments/[id]/tx-status", () => {
  beforeEach(() => {
    vi.mocked(pollEventsFor).mockClear();
    mockDb.deployment.findUnique.mockResolvedValue({ graphSnapshot: null });
    mockDb.auditLog.findFirst.mockReset();
    mockDb.auditLog.findFirst.mockResolvedValue({ id: "audit-1" });
  });

  it("ingests the deployment's events once the transaction succeeds", async () => {
    mockRpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 4598539 });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { status: "SUCCESS", txHash: TX_HASH } });
    expect(pollEventsFor).toHaveBeenCalledWith(DEPLOYMENT_ID);
  });

  it("still reports SUCCESS when ingestion throws", async () => {
    mockRpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 4598539 });
    vi.mocked(pollEventsFor).mockRejectedValueOnce(new Error("rpc down"));
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe("SUCCESS");
  });

  it("still reports SUCCESS when ingestion outruns its deadline", async () => {
    vi.useFakeTimers();
    try {
      mockRpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 4598539 });
      // A stalled getEvents: the SDK sets no HTTP timeout, so nothing else
      // would ever settle this.
      vi.mocked(pollEventsFor).mockReturnValueOnce(new Promise<number>(() => {}));

      const pending = call();
      await vi.advanceTimersByTimeAsync(5_000);
      const res = await pending;

      expect(res.status).toBe(200);
      expect((await res.json()).data.status).toBe("SUCCESS");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not poll while the transaction is still pending", async () => {
    mockRpc.getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
    const res = await call();
    expect((await res.json()).data.status).toBe("PENDING");
    expect(pollEventsFor).not.toHaveBeenCalled();
  });

  it("404s a txHash this app never submitted for this deployment", async () => {
    mockDb.auditLog.findFirst.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("does not reach the network or ingest events for an unbound txHash", async () => {
    mockDb.auditLog.findFirst.mockResolvedValue(null);
    mockRpc.getTransaction.mockClear();
    await call();
    expect(mockRpc.getTransaction).not.toHaveBeenCalled();
    expect(pollEventsFor).not.toHaveBeenCalled();
  });

  it("looks the pair up on both the deployment id and the txHash", async () => {
    mockRpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 4598539 });
    await call();
    const where = mockDb.auditLog.findFirst.mock.calls[0]![0].where;
    expect(where.AND).toEqual([
      { metadata: { path: ["deploymentId"], equals: DEPLOYMENT_ID } },
      { metadata: { path: ["txHash"], equals: TX_HASH } },
    ]);
  });
});
