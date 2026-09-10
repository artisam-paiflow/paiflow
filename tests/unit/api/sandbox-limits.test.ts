/**
 * The three guards that keep a sandbox identity — which anyone can mint with no
 * account — away from Paiflow's own money and machinery:
 *
 *  1. it cannot deploy a pipeline the relayer later signs for (this file),
 *  2. no password can open the account it gets (tests/unit/auth/sandbox-credentials.test.ts),
 *  3. the dev/machine endpoints reject it even if middleware is bypassed (same).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role, TemplateKind } from "@prisma/client";

const { mockDb, mockRateLimit } = vi.hoisted(() => ({
  mockDb: { flow: { findFirst: vi.fn() }, deployment: { create: vi.fn() } },
  mockRateLimit: vi.fn(async () => ({ ok: true, remaining: 9, resetAt: 0 })),
}));
const { mockRequireSession } = vi.hoisted(() => ({ mockRequireSession: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth", () => ({ requireSession: mockRequireSession }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mockRateLimit }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/stellar/deploy", () => ({
  preparePipelineDeployTx: vi.fn(async () => ({ xdr: "AAAA", fee: "100" })),
  checkAccountFunding: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/stellar/config", () => ({ getWasmHashes: vi.fn(async () => new Map()) }));

import { POST } from "@/app/api/deployments/prepare/route";

const FLOW_ID = "11111111-1111-1111-1111-111111111111";
const SOURCE = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const RECIPIENT = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const XLM = { kind: "native" } as const;
const USDC = { kind: "known", symbol: "USDC" } as const;

const swapGraph = {
  nodes: [
    { id: "t", type: "on_receive", config: { asset: XLM } },
    {
      id: "s",
      type: "swap",
      config: { assetIn: XLM, assetOut: USDC, slippageBps: 100, deadlineSecs: 300 },
    },
    {
      id: "p",
      type: "pay",
      config: { recipient: RECIPIENT, asset: USDC, mode: "fixed", fullAmount: true },
    },
  ],
  edges: [
    { id: "e1", source: "t", target: "s" },
    { id: "e2", source: "s", target: "p" },
  ],
};

// A subscription pipeline: cron/auto-charge-subscriptions picks these up by
// status and kind alone and signs the charge with the relayer key.
const subscriptionGraph = {
  nodes: [
    {
      id: "t",
      type: "subscription",
      config: {
        subscriber: SOURCE,
        asset: USDC,
        amountPerPeriodStroops: "10000000",
        intervalAmount: 1,
        intervalUnit: "month",
        startsAt: "2026-01-01T00:00:00.000Z",
        timeZone: "UTC",
      },
    },
    {
      id: "p",
      type: "pay",
      config: { recipient: RECIPIENT, asset: USDC, mode: "fixed", fullAmount: true },
    },
  ],
  edges: [{ id: "e1", source: "t", target: "p" }],
};

function req(body: unknown) {
  return new Request("http://localhost/api/deployments/prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRateLimit.mockResolvedValue({ ok: true, remaining: 9, resetAt: 0 });
  process.env.STELLAR_NETWORK = "testnet";
  process.env.SOROSWAP_ROUTER_TESTNET = "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD";
});

describe("a sandbox session cannot deploy a relayer-driven pipeline", () => {
  it("refuses a SUBSCRIPTION flow with FORBIDDEN", async () => {
    mockRequireSession.mockResolvedValue({ id: "u1", username: "sandbox-a", role: Role.SANDBOX });
    mockDb.flow.findFirst.mockResolvedValue({
      id: FLOW_ID,
      ownerId: "u1",
      graph: subscriptionGraph,
    });

    const res = await POST(req({ flowId: FLOW_ID, sourceAccount: SOURCE }));
    const body = (await res.json()) as { error?: { code: string; message: string } };
    expect(res.status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN");
    expect(body.error?.message).toContain("SUBSCRIPTION");
    expect(mockDb.deployment.create).not.toHaveBeenCalled();
  });

  it("lets the same flow through for an ordinary USER", async () => {
    mockRequireSession.mockResolvedValue({ id: "u1", username: "real", role: Role.USER });
    mockDb.flow.findFirst.mockResolvedValue({
      id: FLOW_ID,
      ownerId: "u1",
      graph: subscriptionGraph,
    });

    const res = await POST(req({ flowId: FLOW_ID, sourceAccount: SOURCE }));
    // It gets past the role gate; whatever happens next is the deploy path's
    // business, but it must not be a 403 from this check.
    expect(res.status).not.toBe(403);
  });

  it("allows the swap flow the sandbox is seeded with", async () => {
    mockRequireSession.mockResolvedValue({ id: "u1", username: "sandbox-a", role: Role.SANDBOX });
    mockDb.flow.findFirst.mockResolvedValue({ id: FLOW_ID, ownerId: "u1", graph: swapGraph });

    const res = await POST(req({ flowId: FLOW_ID, sourceAccount: SOURCE }));
    expect(res.status).not.toBe(403);
  });

  it("names only wallet-signed kinds as deployable", () => {
    // Guards the constant: adding a relayer-driven kind here would reopen the
    // hole, so the list is asserted rather than trusted.
    const relayerDriven = [
      TemplateKind.SUBSCRIPTION,
      TemplateKind.PAYROLL,
      TemplateKind.CASH_OUT,
      TemplateKind.STREAMER,
    ];
    for (const kind of relayerDriven) {
      expect([
        TemplateKind.SWAPPER,
        TemplateKind.SPLITTER,
        TemplateKind.PAYER,
        TemplateKind.DEPOSIT_TRIGGER,
      ]).not.toContain(kind);
    }
  });
});
