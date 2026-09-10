/**
 * The three guards that keep a sandbox identity — which anyone can mint with no
 * account — away from Paiflow's own money and machinery:
 *
 *  1. it cannot deploy a pipeline the relayer later signs for (this file),
 *  2. no password can open the account it gets (tests/unit/auth/sandbox-credentials.test.ts),
 *  3. the dev/machine endpoints reject it even if middleware is bypassed (same).
 *
 * The guard is over every node of the generated pipeline, not the flow's
 * top-level kind, so the interesting cases here are the ones that classify as
 * an allowed kind and still emit a relayer-backed node.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Role, TemplateKind } from "@prisma/client";
import { SANDBOX_TEMPLATE_KINDS } from "@/lib/sandbox";

// env() memoizes its parse on first call, and importing the route triggers one,
// so these have to be in place before the imports below rather than in a
// beforeEach. tests/unit/setup.ts scrubs them again for the next file; afterAll
// keeps this one honest per CLAUDE.md §1.
const ENV_UNDER_TEST = vi.hoisted(() => {
  const vars = {
    STELLAR_NETWORK: "testnet",
    STELLAR_SOROSWAP_ROUTER_TESTNET: "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD",
    STELLAR_RELAYER_ADDRESS: "GDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4",
  };
  Object.assign(process.env, vars);
  return Object.keys(vars);
});

const { mockDb, mockRateLimit } = vi.hoisted(() => ({
  mockDb: {
    flow: { findFirst: vi.fn() },
    deployment: { create: vi.fn(), update: vi.fn() },
  },
  mockRateLimit: vi.fn(async () => ({ ok: true, remaining: 9, resetAt: 0, shared: true })),
}));
const { mockRequireSession } = vi.hoisted(() => ({ mockRequireSession: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth", () => ({ requireSession: mockRequireSession }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mockRateLimit }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/stellar/deploy", () => ({
  preparePipelineDeployTx: vi.fn(async () => ({
    xdr: "AAAA",
    pipeline: [
      { nodeId: "t", contractAddress: "CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ" },
    ],
  })),
  checkAccountFunding: vi.fn(async () => ({ ok: true })),
}));
// Seeded with every kind the graphs below compile to, so an allowed flow runs
// all the way to deployment.create instead of stopping at the WASM-hash check.
vi.mock("@/lib/stellar/config", () => ({
  getWasmHashes: vi.fn(
    async () =>
      new Map([
        [TemplateKind.DEPOSIT_TRIGGER, "hash-trigger"],
        [TemplateKind.WEBHOOK, "hash-webhook"],
        [TemplateKind.SWAPPER, "hash-swapper"],
        [TemplateKind.PAYER, "hash-payer"],
        [TemplateKind.PAYER_DEV, "hash-payer-dev"],
        [TemplateKind.SPLITTER, "hash-splitter"],
        [TemplateKind.SPLITTER_DEV, "hash-splitter-dev"],
        [TemplateKind.SUBSCRIPTION, "hash-subscription"],
      ]),
  ),
}));

import { POST } from "@/app/api/deployments/prepare/route";

const FLOW_ID = "11111111-1111-1111-1111-111111111111";
const SOURCE = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const RECIPIENT = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const RECIPIENT_2 = "GDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4";

const XLM = { kind: "native" } as const;
const USDC = { kind: "known", symbol: "USDC" } as const;

const swapNodes = [
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
];

const swapGraph = {
  nodes: [{ id: "t", type: "on_receive", config: { asset: XLM } }, ...swapNodes],
  edges: [
    { id: "e1", source: "t", target: "s" },
    { id: "e2", source: "s", target: "p" },
  ],
};

// Classifies as SWAPPER — the same top-level kind as the seeded flow — but
// flowToPipeline emits a WEBHOOK node whose authorized caller is the relayer,
// and the public /api/webhooks/:id route signs every call with the relayer key.
const webhookSwapGraph = {
  nodes: [{ id: "t", type: "web2_webhook", config: { asset: XLM } }, ...swapNodes],
  edges: [
    { id: "e1", source: "t", target: "s" },
    { id: "e2", source: "s", target: "p" },
  ],
};

// Classifies as SPLITTER, but devMode swaps the splitter for SPLITTER_DEV,
// whose admin is the relayer.
const devSplitterGraph = {
  devMode: true,
  nodes: [
    { id: "t", type: "on_receive", config: { asset: XLM } },
    {
      id: "sp",
      type: "split",
      config: {
        asset: XLM,
        recipients: [
          { address: RECIPIENT, mode: "percentage", bps: 6000, label: "A" },
          { address: RECIPIENT_2, mode: "percentage", bps: 4000, label: "B" },
        ],
      },
    },
  ],
  edges: [{ id: "e1", source: "t", target: "sp" }],
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

function asSandbox(graph: unknown) {
  mockRequireSession.mockResolvedValue({ id: "u1", username: "sandbox-a", role: Role.SANDBOX });
  mockDb.flow.findFirst.mockResolvedValue({ id: FLOW_ID, ownerId: "u1", graph });
}

async function post() {
  const res = await POST(req({ flowId: FLOW_ID, sourceAccount: SOURCE }));
  const body = (await res.json()) as { error?: { code: string; message: string } };
  return { res, body };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRateLimit.mockResolvedValue({ ok: true, remaining: 9, resetAt: 0, shared: true });
  mockDb.deployment.create.mockResolvedValue({ id: "22222222-2222-2222-2222-222222222222" });
  mockDb.deployment.update.mockResolvedValue({});
});

afterAll(() => {
  for (const name of ENV_UNDER_TEST) delete process.env[name];
});

describe("a sandbox session cannot deploy a relayer-driven pipeline", () => {
  it("refuses a SUBSCRIPTION flow with FORBIDDEN", async () => {
    asSandbox(subscriptionGraph);

    const { res, body } = await post();
    expect(res.status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN");
    expect(body.error?.message).toContain("SUBSCRIPTION");
    expect(mockDb.deployment.create).not.toHaveBeenCalled();
  });

  it("refuses a web2_webhook flow that classifies as SWAPPER", async () => {
    // The top-level kind is on the allowlist; the WEBHOOK node it compiles to
    // is not. Guarding only v.templateKind let this through.
    asSandbox(webhookSwapGraph);

    const { res, body } = await post();
    expect(res.status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN");
    expect(body.error?.message).toContain(TemplateKind.WEBHOOK);
    expect(mockDb.deployment.create).not.toHaveBeenCalled();
  });

  it("refuses a devMode flow whose nodes compile to *_DEV contracts", async () => {
    // SPLITTER is allowed, SPLITTER_DEV is not: the mutable variants take the
    // relayer as admin so the dev-* routes can rewrite them after deploy.
    asSandbox(devSplitterGraph);

    const { res, body } = await post();
    expect(res.status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN");
    expect(body.error?.message).toContain(TemplateKind.SPLITTER_DEV);
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

  it("lets the webhook flow through for an ordinary USER", async () => {
    mockRequireSession.mockResolvedValue({ id: "u1", username: "real", role: Role.USER });
    mockDb.flow.findFirst.mockResolvedValue({
      id: FLOW_ID,
      ownerId: "u1",
      graph: webhookSwapGraph,
    });

    const res = await POST(req({ flowId: FLOW_ID, sourceAccount: SOURCE }));
    expect(res.status).toBe(200);
    expect(mockDb.deployment.create).toHaveBeenCalled();
  });

  it("allows the swap flow the sandbox is seeded with", async () => {
    asSandbox(swapGraph);

    const res = await POST(req({ flowId: FLOW_ID, sourceAccount: SOURCE }));
    // Asserting the success path, not merely "not 403": with the WASM hashes
    // mocked out the route used to fail on VALIDATION before ever reaching
    // deployment.create, so a rejected swap flow would have passed too.
    expect(res.status).toBe(200);
    expect(mockDb.deployment.create).toHaveBeenCalled();
  });

  it("names only wallet-signed kinds as deployable", () => {
    // Guards the production constant: adding a relayer-driven kind to it would
    // reopen the hole, so the list is asserted rather than trusted.
    for (const kind of [
      TemplateKind.SUBSCRIPTION,
      TemplateKind.PAYROLL,
      TemplateKind.CASH_OUT,
      TemplateKind.STREAMER,
      TemplateKind.WEBHOOK,
      TemplateKind.SPLITTER_DEV,
      TemplateKind.PAYER_DEV,
      TemplateKind.SUBSCRIPTION_DEV,
      TemplateKind.CASH_OUT_DEV,
    ]) {
      expect(SANDBOX_TEMPLATE_KINDS).not.toContain(kind);
    }
  });
});
