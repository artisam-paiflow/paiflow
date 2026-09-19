/**
 * #557, relayer side: `submitWebhookExecuteTx` shares the send classification
 * with `submitTriggerTx`, so `POST /api/webhooks/:id` sees the same two new
 * answers. A refused send reaches the caller as a logged 502 with no
 * DEPLOY_TRIGGER row, and a duplicate writes no second one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

const { mockDb, mockSubmit } = vi.hoisted(() => ({
  mockDb: { deployment: { findFirst: vi.fn() } },
  mockSubmit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/stellar/trigger", () => ({ submitWebhookExecuteTx: mockSubmit }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => undefined),
  clientIp: vi.fn(() => "203.0.113.9"),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { POST } from "@/app/api/webhooks/[id]/route";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { DEPLOYMENT_ID, OWNER_ID, TRIGGER, ctx } from "./v1/execute-fixtures";

const SECRET = `whsec_${"a".repeat(64)}`;
const FROM = Keypair.random().publicKey();

function call() {
  const req = new Request(`https://paiflow.test/api/webhooks/${DEPLOYMENT_ID}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-webhook-secret": SECRET },
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
  });
});

describe("POST /api/webhooks/[id]", () => {
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
