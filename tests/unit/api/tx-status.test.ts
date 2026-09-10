/**
 * QA-D1 ISSUE-002: a confirmed trigger must land its contract events in the
 * store before the status response returns, so the deployment page the user
 * opens next renders them without waiting for the cron poller.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRpc, mockDb } = vi.hoisted(() => ({
  mockRpc: { getTransaction: vi.fn() },
  mockDb: { deployment: { findUnique: vi.fn() } },
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

  it("does not poll while the transaction is still pending", async () => {
    mockRpc.getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
    const res = await call();
    expect((await res.json()).data.status).toBe("PENDING");
    expect(pollEventsFor).not.toHaveBeenCalled();
  });
});
