/**
 * QA-D1 ISSUE-002: a confirmed trigger must land its contract events in the
 * store before the status response returns, so the deployment page the user
 * opens next renders them without waiting for the cron poller.
 *
 * Also covers the side-effect binding. The route is public (the `/trigger/:id`
 * page has no session) and reachable by a sandbox identity. The status answer
 * itself is public chain data and is deliberately NOT gated; what is gated is
 * the bookkeeping that follows a confirmation — above all `recordAllowanceEvent`,
 * which would otherwise let an arbitrary caller publish a fabricated ALLOWANCE
 * event into another deployment's live feed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRpc, mockDb, mockEnforceRateLimit, mockRedis, mockCapture } = vi.hoisted(() => ({
  mockRpc: { getTransaction: vi.fn() },
  mockDb: { deployment: { findUnique: vi.fn() }, signedTransaction: { findUnique: vi.fn() } },
  mockEnforceRateLimit: vi.fn(async (_opts: { key: string }) => undefined),
  mockRedis: { set: vi.fn(), del: vi.fn(), expire: vi.fn() },
  mockCapture: vi.fn(async () => undefined),
}));
vi.mock("@/lib/redis", () => ({ redis: () => mockRedis }));
vi.mock("@/lib/analytics/server", () => ({ captureServer: mockCapture }));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => mockRpc }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mockEnforceRateLimit,
  clientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(), wasTxSubmittedFor: vi.fn() }));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/stellar/events", () => ({
  pollEventsFor: vi.fn(async () => 1),
  recordAllowanceEvent: vi.fn(async () => undefined),
}));

import { GET } from "@/app/api/deployments/[id]/tx-status/route";
import { pollEventsFor, recordAllowanceEvent } from "@/lib/stellar/events";
import { audit, wasTxSubmittedFor } from "@/lib/audit";

const DEPLOYMENT_ID = "44c3ed53-9b6d-4be0-bade-e5fcc6c7a0eb";
const SIGNER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const TX_HASH = "8d8707228a6b1d30b01dd2f5c6d956961f090cd9cd690c73d994f7a8a4ec8f3f";

function call(hash: string = TX_HASH) {
  const req = new Request(
    `http://localhost/api/deployments/${DEPLOYMENT_ID}/tx-status?txHash=${hash}`,
  );
  return GET(req as unknown as import("next/server").NextRequest, {
    params: Promise.resolve({ id: DEPLOYMENT_ID }),
  });
}

describe("GET /api/deployments/[id]/tx-status", () => {
  beforeEach(() => {
    vi.mocked(pollEventsFor).mockClear();
    vi.mocked(recordAllowanceEvent).mockClear();
    vi.mocked(audit).mockClear();
    mockRpc.getTransaction.mockReset();
    mockEnforceRateLimit.mockClear();
    mockDb.deployment.findUnique.mockResolvedValue({ graphSnapshot: null });
    mockDb.signedTransaction.findUnique.mockReset();
    vi.mocked(wasTxSubmittedFor).mockReset();
    vi.mocked(wasTxSubmittedFor).mockResolvedValue(true);
    mockCapture.mockClear();
    const claimed = new Set<string>();
    mockRedis.set.mockReset();
    mockRedis.set.mockImplementation(async (key: string) => {
      if (claimed.has(key)) return null;
      claimed.add(key);
      return "OK";
    });
    mockRedis.del.mockReset();
    mockRedis.del.mockImplementation(async (key: string) => (claimed.delete(key) ? 1 : 0));
    mockRedis.expire.mockReset();
    mockRedis.expire.mockResolvedValue(1);
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

  // The status of a transaction on a public chain is not ours to withhold, and
  // the caller already has the hash. Gating the read is what broke the dev-mode
  // payroll screen, whose relayer submissions write no audit row.
  it("still answers with the status for a txHash it did not submit", async () => {
    vi.mocked(wasTxSubmittedFor).mockResolvedValue(false);
    mockRpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 4598539 });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { status: "SUCCESS", txHash: TX_HASH } });
  });

  // The regression guard that matters: recordAllowanceEvent writes a
  // ContractEvent for `id` from whatever envelope the hash resolves to, and
  // publishes it to that deployment's SSE channel.
  it("runs none of the deployment bookkeeping for a txHash it did not submit", async () => {
    vi.mocked(wasTxSubmittedFor).mockResolvedValue(false);
    mockRpc.getTransaction.mockResolvedValue({
      status: "SUCCESS",
      ledger: 4598539,
      envelopeXdr: "AAAA",
    });
    await call();
    expect(recordAllowanceEvent).not.toHaveBeenCalled();
    expect(pollEventsFor).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("asks the binding question with the deployment id and the txHash", async () => {
    mockRpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 4598539 });
    await call();
    expect(wasTxSubmittedFor).toHaveBeenCalledWith(DEPLOYMENT_ID, TX_HASH);
  });

  // PENDING is where the poller spends nearly all of its requests, so it must
  // cost no database work at all.
  it("does no database work while the transaction is still pending", async () => {
    mockRpc.getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
    await call();
    expect(wasTxSubmittedFor).not.toHaveBeenCalled();
  });

  it("rejects a malformed txHash before reaching the network or the database", async () => {
    const res = await call("not-a-hash");
    expect(res.status).toBe(422);
    expect(mockRpc.getTransaction).not.toHaveBeenCalled();
    expect(wasTxSubmittedFor).not.toHaveBeenCalled();
  });

  it("lowercases the hash so it matches the form the audit rows carry", async () => {
    mockRpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 4598539 });
    await call(TX_HASH.toUpperCase());
    expect(wasTxSubmittedFor).toHaveBeenCalledWith(DEPLOYMENT_ID, TX_HASH);
    expect(mockRpc.getTransaction).toHaveBeenCalledWith(TX_HASH);
  });

  // The comment above the lookup calls the audit row "permission for an
  // optimisation". A database blip must therefore cost the optimisation, not the
  // answer: the hook reports any non-OK response as a failed transaction.
  it("still answers when the submit lookup itself fails", async () => {
    vi.mocked(wasTxSubmittedFor).mockRejectedValue(new Error("db down"));
    mockRpc.getTransaction.mockResolvedValue({
      status: "SUCCESS",
      ledger: 4598539,
      createdAt: 1789094227,
      envelopeXdr: "AAAA",
    });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { status: "SUCCESS", txHash: TX_HASH } });
    expect(recordAllowanceEvent).not.toHaveBeenCalled();
    expect(pollEventsFor).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  // `ledgerClosedAt` belongs to the getEvents shape, not to getTransaction, so
  // reading it only ever produced the Date.now() fallback and occurredAt
  // recorded ingestion time.
  it("records the ledger close time, not the time we ingested", async () => {
    mockRpc.getTransaction.mockResolvedValue({
      status: "SUCCESS",
      ledger: 4598539,
      createdAt: 1789094227,
      envelopeXdr: "AAAA",
    });
    await call();
    expect(recordAllowanceEvent).toHaveBeenCalledWith(
      expect.objectContaining({ occurredAt: new Date(1789094227 * 1000) }),
    );
  });

  // The route is public, so a limit keyed on the caller-controlled deployment id
  // would hand out a fresh bucket per request.
  // #561: the route is public, so a replayed hash must not buy an audit row and
  // an RPC ingest pass per request.
  it("does the confirmation bookkeeping once across repeated SUCCESS polls", async () => {
    mockRpc.getTransaction.mockResolvedValue({
      status: "SUCCESS",
      ledger: 4598539,
      createdAt: 1757600000,
      envelopeXdr: "AAAA",
    });
    for (let i = 0; i < 3; i++) {
      const res = await call();
      expect(await res.json()).toEqual({ data: { status: "SUCCESS", txHash: TX_HASH } });
    }
    expect(audit).toHaveBeenCalledTimes(1);
    expect(pollEventsFor).toHaveBeenCalledTimes(1);
    expect(recordAllowanceEvent).toHaveBeenCalledTimes(1);
    expect(wasTxSubmittedFor).toHaveBeenCalledTimes(1);
  });

  it("gives the claim back when the submit lookup fails, so the next poll retries", async () => {
    mockRpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 4598539 });
    vi.mocked(wasTxSubmittedFor).mockRejectedValueOnce(new Error("db blip"));
    await call();
    expect(pollEventsFor).not.toHaveBeenCalled();
    await call();
    expect(pollEventsFor).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("takes the claim as a short lease and keeps it only once the lookup has answered", async () => {
    mockRpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 4598539 });
    await call();
    const [key, , , lease] = mockRedis.set.mock.calls[0]!;
    expect(lease).toBe(60);
    expect(mockRedis.expire).toHaveBeenCalledWith(key, 7 * 24 * 60 * 60);
  });

  it("leaves the claim on its lease when the lookup fails", async () => {
    mockRpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 4598539 });
    vi.mocked(wasTxSubmittedFor).mockRejectedValueOnce(new Error("db blip"));
    mockRedis.del.mockRejectedValueOnce(new Error("redis blip"));
    const res = await call();
    expect(res.status).toBe(200);
    expect(mockRedis.expire).not.toHaveBeenCalled();
  });

  it("does not release a claim it never took", async () => {
    mockRpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 4598539 });
    mockRedis.set.mockRejectedValueOnce(new Error("redis blip"));
    vi.mocked(wasTxSubmittedFor).mockRejectedValueOnce(new Error("db blip"));
    await call();
    expect(mockRedis.del).not.toHaveBeenCalled();
    expect(mockRedis.expire).not.toHaveBeenCalled();
  });

  it("still records the allowance event when the graph read fails", async () => {
    mockRpc.getTransaction.mockResolvedValue({
      status: "SUCCESS",
      ledger: 4598539,
      createdAt: 1_790_000_000,
      envelopeXdr: "AAAA",
    });
    mockDb.deployment.findUnique.mockRejectedValue(new Error("db blip"));
    await call();
    expect(recordAllowanceEvent).toHaveBeenCalledWith(expect.objectContaining({ graph: null }));
  });

  it("still does the bookkeeping when the claim itself errors", async () => {
    mockRpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 4598539 });
    mockRedis.set.mockRejectedValue(new Error("redis down"));
    await call();
    expect(pollEventsFor).toHaveBeenCalledTimes(1);
  });

  it("rate-limits on the ip alone before the per-deployment bucket", async () => {
    mockRpc.getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
    await call();
    const firstKey = mockEnforceRateLimit.mock.calls[0]![0].key;
    expect(firstKey).not.toContain(DEPLOYMENT_ID);
    expect(firstKey).toBe("tx-status:ip:127.0.0.1");
    expect(mockEnforceRateLimit.mock.calls[1]![0].key).toContain(DEPLOYMENT_ID);
  });

  it.each([
    ["SUCCESS", "trigger_confirmed"],
    ["FAILED", "trigger_failed_onchain"],
  ])("captures a %s outcome once across repeated polls", async (status, event) => {
    mockRpc.getTransaction.mockResolvedValue({ status, ledger: 4598539 });
    mockDb.deployment.findUnique.mockResolvedValue({
      ownerId: "owner-1",
      pipelineSnapshot: [],
      graphSnapshot: null,
    });
    for (let i = 0; i < 3; i++) {
      const res = await call();
      expect((await res.json()).data.status).toBe(status);
    }
    await vi.waitFor(() => expect(mockRedis.set).toHaveBeenCalledTimes(3));
    await new Promise((r) => setTimeout(r, 0));
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith("owner-1", event, expect.anything(), undefined);
  });

  // The owner is only the fallback for transactions from before signers were
  // recorded; a SignedTransaction row names who actually signed.
  it("attributes the outcome to the signer's user when the signer was signed in", async () => {
    mockRpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 4598539 });
    mockDb.deployment.findUnique.mockResolvedValue({
      ownerId: "owner-1",
      pipelineSnapshot: [],
      graphSnapshot: null,
    });
    mockDb.signedTransaction.findUnique.mockResolvedValue({
      userId: "signer-user-9",
      signerAddress: SIGNER,
    });
    await call();
    await vi.waitFor(() => expect(mockCapture).toHaveBeenCalledTimes(1));
    expect(mockCapture).toHaveBeenCalledWith(
      "signer-user-9",
      "trigger_confirmed",
      expect.objectContaining({ signer_address: SIGNER }),
      undefined,
    );
  });

  it("keys an anonymous signer on the wallet with no person profile", async () => {
    mockRpc.getTransaction.mockResolvedValue({ status: "FAILED", ledger: 4598539 });
    mockDb.deployment.findUnique.mockResolvedValue({
      ownerId: "owner-1",
      pipelineSnapshot: [],
      graphSnapshot: null,
    });
    mockDb.signedTransaction.findUnique.mockResolvedValue({ userId: null, signerAddress: SIGNER });
    await call();
    await vi.waitFor(() => expect(mockCapture).toHaveBeenCalledTimes(1));
    expect(mockCapture).toHaveBeenCalledWith(
      `wallet:${SIGNER}`,
      "trigger_failed_onchain",
      expect.objectContaining({ signer_address: SIGNER }),
      { personProfile: false },
    );
  });
});
