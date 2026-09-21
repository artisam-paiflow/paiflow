/**
 * The trigger page is public and its locked amount field is only cosmetic —
 * anyone can POST this route directly. Over-funding a fixed payer is not
 * refused on chain: the payer pays `min(incoming, configured)` and a terminal
 * one keeps the surplus, reachable afterwards only by the admin-only
 * `cancel()`. So the refusal has to happen here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, mockPrepareTriggerTx, mockPrepareWebhookDepositTx, mockPrepareStreamerTopUp } =
  vi.hoisted(() => ({
    mockDb: { deployment: { findFirst: vi.fn() } },
    mockPrepareTriggerTx: vi.fn(async () => ({ xdr: "XDR" })),
    mockPrepareWebhookDepositTx: vi.fn(async () => ({ xdr: "XDR" })),
    mockPrepareStreamerTopUp: vi.fn(async () => ({ xdr: "XDR" })),
  }));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/stellar/trigger", () => ({
  prepareTriggerTx: mockPrepareTriggerTx,
  prepareWebhookDepositTx: mockPrepareWebhookDepositTx,
}));
vi.mock("@/lib/stellar/invoke", () => ({
  prepareStreamerTopUpInvocation: mockPrepareStreamerTopUp,
}));
vi.mock("@/lib/stellar/pipeline-error-hint", () => ({
  buildPipelineErrorHint: vi.fn(async () => undefined),
}));
vi.mock("@/lib/env", () => ({ stellarPassphrase: () => "Test SDF Network ; September 2015" }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => undefined),
  clientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { POST } from "@/app/api/deployments/[id]/trigger/route";
import { log } from "@/lib/log";

const ID = "44c3ed53-9b6d-4be0-bade-e5fcc6c7a0eb";
const USER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const RECIPIENT = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const XLM = { kind: "native" };

const FIVE = "50000000";
const SEVEN = "70000000";

/** on_receive → pay 5 XLM: consumption is exactly 5. */
const fixedPayGraph = {
  nodes: [
    { id: "t", type: "on_receive", config: { asset: XLM } },
    {
      id: "p",
      type: "pay",
      config: {
        recipient: RECIPIENT,
        asset: XLM,
        mode: "fixed",
        amountStroops: FIVE,
        fullAmount: false,
      },
    },
  ],
  edges: [{ id: "e0", source: "t", target: "p" }],
};

const percentagePayGraph = {
  nodes: [
    { id: "t", type: "on_receive", config: { asset: XLM } },
    {
      id: "p",
      type: "pay",
      config: {
        recipient: RECIPIENT,
        asset: XLM,
        mode: "percentage",
        percentage: 50,
        fullAmount: false,
      },
    },
  ],
  edges: [{ id: "e0", source: "t", target: "p" }],
};

function deployment(over: Record<string, unknown> = {}) {
  return {
    id: ID,
    contractAddress: "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K",
    graphSnapshot: fixedPayGraph,
    pipelineSnapshot: [
      { nodeId: "t", contractAddress: "CTRIG", templateKind: "DEPOSIT_TRIGGER" },
      { nodeId: "p", contractAddress: "CPAY", templateKind: "PAYER" },
    ],
    flow: { templateKind: "SPLITTER" },
    ...over,
  };
}

function call(amount: string) {
  const req = new Request(`http://localhost/api/deployments/${ID}/trigger`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount, userAddress: USER }),
  });
  return POST(req as unknown as import("next/server").NextRequest, {
    params: Promise.resolve({ id: ID }),
  });
}

describe("POST /api/deployments/[id]/trigger — amount guard", () => {
  beforeEach(() => {
    mockPrepareTriggerTx.mockClear();
    mockPrepareWebhookDepositTx.mockClear();
    mockPrepareStreamerTopUp.mockClear();
    vi.mocked(log.warn).mockClear();
    mockDb.deployment.findFirst.mockResolvedValue(deployment());
  });

  it("refuses an amount above what a fixed pay consumes", async () => {
    const res = await call(SEVEN);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.message).toContain("5");
    expect(body.error.message).toContain("7");
    expect(mockPrepareTriggerTx).not.toHaveBeenCalled();
  });

  it("refuses an amount below it too, which would under-pay the recipient", async () => {
    const res = await call("30000000");
    expect(res.status).toBe(422);
    expect(mockPrepareTriggerTx).not.toHaveBeenCalled();
  });

  it("prepares the transaction when the amount matches", async () => {
    const res = await call(FIVE);
    expect(res.status).toBe(200);
    expect(mockPrepareTriggerTx).toHaveBeenCalledWith(expect.objectContaining({ amount: FIVE }));
  });

  it("leaves a percentage flow free-form", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(
      deployment({ graphSnapshot: percentagePayGraph }),
    );
    const res = await call(SEVEN);
    expect(res.status).toBe(200);
    expect(mockPrepareTriggerTx).toHaveBeenCalled();
  });

  it("does not guard a webhook deposit, which is open-ended funding", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(
      deployment({
        pipelineSnapshot: [{ nodeId: "t", contractAddress: "CWH", templateKind: "WEBHOOK" }],
      }),
    );
    const res = await call(SEVEN);
    expect(res.status).toBe(200);
    expect(mockPrepareWebhookDepositTx).toHaveBeenCalled();
  });

  it("does not guard a streamer top-up", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(
      deployment({ flow: { templateKind: "STREAMER" } }),
    );
    const res = await call(SEVEN);
    expect(res.status).toBe(200);
    expect(mockPrepareStreamerTopUp).toHaveBeenCalled();
  });

  it("still guards a legacy row whose split recipients predate the `mode` field", async () => {
    // Without migrateFlowGraph these fail FlowGraphSchema and fall through the
    // guard — the oldest deployments would be the least protected.
    const legacy = {
      nodes: [
        { id: "t", type: "on_receive", config: { asset: XLM } },
        {
          id: "s",
          type: "split",
          config: {
            asset: XLM,
            recipients: [
              { address: RECIPIENT, bps: 6000 },
              { address: USER, bps: 4000 },
            ],
          },
        },
      ],
      edges: [{ id: "e0", source: "t", target: "s" }],
    };
    mockDb.deployment.findFirst.mockResolvedValue(deployment({ graphSnapshot: legacy }));
    const res = await call(SEVEN);
    // A percentage split consumes everything, so this one is legitimately
    // free-form — what matters is that it parsed rather than warned.
    expect(res.status).toBe(200);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("fails open on a graph snapshot that no longer parses, and says so", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(
      deployment({ graphSnapshot: { nodes: "not a graph" } }),
    );
    const res = await call(SEVEN);
    expect(res.status).toBe(200);
    expect(mockPrepareTriggerTx).toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
  });
});

describe("POST /api/deployments/[id]/trigger — amount shape", () => {
  beforeEach(() => {
    mockDb.deployment.findFirst.mockClear();
    mockPrepareTriggerTx.mockClear();
    mockPrepareWebhookDepositTx.mockClear();
    mockPrepareStreamerTopUp.mockClear();
    mockDb.deployment.findFirst.mockResolvedValue(
      deployment({
        pipelineSnapshot: [{ nodeId: "t", contractAddress: "CWH", templateKind: "WEBHOOK" }],
      }),
    );
  });

  function expectNothingPrepared() {
    expect(mockDb.deployment.findFirst).not.toHaveBeenCalled();
    expect(mockPrepareTriggerTx).not.toHaveBeenCalled();
    expect(mockPrepareWebhookDepositTx).not.toHaveBeenCalled();
    expect(mockPrepareStreamerTopUp).not.toHaveBeenCalled();
  }

  it("refuses zero with a field error", async () => {
    const res = await call("0");
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.fields.amount).toBeDefined();
    expectNothingPrepared();
  });

  it("refuses an amount past i128 with a 422, not a RangeError 500", async () => {
    const res = await call((1n << 127n).toString());
    expect(res.status).toBe(422);
    expectNothingPrepared();
  });

  it("accepts the i128 ceiling itself", async () => {
    const res = await call(((1n << 127n) - 1n).toString());
    expect(res.status).toBe(200);
    expect(mockPrepareWebhookDepositTx).toHaveBeenCalled();
  });
});
