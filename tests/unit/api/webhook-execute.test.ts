/**
 * #557, relayer side: `submitWebhookExecuteTx` shares the send classification
 * with `submitTriggerTx`, so `POST /api/webhooks/:id` sees the same two new
 * answers. A refused send reaches the caller as a logged 502 with no
 * DEPLOY_TRIGGER row, and a duplicate writes no second one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

const { mockDb, mockSubmit, mockKeyed } = vi.hoisted(() => ({
  mockDb: { deployment: { findFirst: vi.fn() } },
  mockSubmit: vi.fn(),
  mockKeyed: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/webhook-idempotency", () => ({ executeKeyedWebhook: mockKeyed }));
vi.mock("@/lib/stellar/trigger", () => ({ submitWebhookExecuteTx: mockSubmit }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => undefined),
  clientIp: vi.fn(() => "203.0.113.9"),
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  needsSubmitRow: vi.fn(async (_d: string, _h: string, duplicate?: boolean) => !duplicate),
}));

import { POST } from "@/app/api/webhooks/[id]/route";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { DEPLOYMENT_ID, OWNER_ID, TRIGGER, ctx } from "./v1/execute-fixtures";

const SECRET = `whsec_${"a".repeat(64)}`;
const FROM = Keypair.random().publicKey();

function call(secret: string | null = SECRET, key?: string) {
  const req = new Request(`https://paiflow.test/api/webhooks/${DEPLOYMENT_ID}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key !== undefined ? { "Idempotency-Key": key } : {}),
      ...(secret === null ? {} : { "x-webhook-secret": secret }),
    },
    body: JSON.stringify({ from: FROM, amount: "10000000" }),
  });
  return POST(req as unknown as import("next/server").NextRequest, ctx());
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.deployment.findFirst.mockResolvedValue({
    id: DEPLOYMENT_ID,
    status: "CONFIRMED",
    webhookSecret: SECRET,
    pipelineSnapshot: [{ nodeId: "hook", contractAddress: TRIGGER, templateKind: "WEBHOOK" }],
    flow: { ownerId: OWNER_ID },
    network: "testnet",
  });
});

describe("POST /api/webhooks/[id]", () => {
  it.each([null, "", "incorrect-secret"])(
    "refuses secret %j without relayer execution",
    async (secret) => {
      const res = await call(secret);
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("FORBIDDEN");
      expect(mockSubmit).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    },
  );

  it("preserves an authorized callback", async () => {
    mockSubmit.mockResolvedValue({ status: "SUCCESS", txHash: "h" });
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).data.txHash).toBe("h");
    expect(mockSubmit).toHaveBeenCalledOnce();
  });

  it("a PENDING send writes the DEPLOY_TRIGGER row", async () => {
    mockSubmit.mockResolvedValue({ status: "PENDING", txHash: "h", duplicate: false });

    const res = await call();

    expect((await res.json()).data).toEqual({ txHash: "h", status: "PENDING" });
    expect(vi.mocked(audit).mock.calls.map(([a]) => a.action)).toEqual(["DEPLOY_TRIGGER"]);
  });

  it("a duplicate send is PENDING and writes no second row", async () => {
    mockSubmit.mockResolvedValue({ status: "PENDING", txHash: "h", duplicate: true });

    const res = await call();

    expect((await res.json()).data).toEqual({ txHash: "h", status: "PENDING" });
    expect(audit).not.toHaveBeenCalled();
  });

  it("502 and no row when the network did not accept the send", async () => {
    mockSubmit.mockRejectedValue(new AppError("UPSTREAM_RPC", "busy; send the request again"));

    const res = await call();

    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("UPSTREAM_RPC");
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("keyed webhook route", () => {
  it("does not reserve an attempt before authenticating", async () => {
    expect((await call("wrong", "event-42")).status).toBe(403);
    expect(mockKeyed).not.toHaveBeenCalled();
  });
  it("returns the durable keyed attempt and bypasses legacy submission", async () => {
    mockKeyed.mockResolvedValue({
      attemptId: "attempt",
      txHash: "a".repeat(64),
      status: "PENDING",
      network: "testnet",
    });
    const res = await call(SECRET, "event-42");
    expect(res.status).toBe(202);
    expect(res.headers.get("retry-after")).toBe("2");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).data.attemptId).toBe("attempt");
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockKeyed).toHaveBeenCalledWith(
      expect.objectContaining({ network: "testnet" }),
      TRIGGER,
      "event-42",
      expect.objectContaining({ escrow: false, from: FROM }),
    );
  });
  it("reports payload conflicts", async () => {
    mockKeyed.mockRejectedValue(new AppError("CONFLICT", "different request"));
    expect((await call(SECRET, "event-42")).status).toBe(409);
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});
