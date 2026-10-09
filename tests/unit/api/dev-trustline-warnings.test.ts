import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb, mockRelayer, horizonMock } = vi.hoisted(() => ({
  mockDb: {
    deployment: { findFirst: vi.fn(), update: vi.fn() },
    employee: { findMany: vi.fn(async () => []) },
  },
  mockRelayer: {
    updatePaymentByRelayer: vi.fn(),
    updateRecipientsByRelayer: vi.fn(),
    updateSubscriberByRelayer: vi.fn(),
    setSubscriptionAmountByRelayer: vi.fn(),
    updateScheduleByRelayer: vi.fn(),
    submitUpdateRecipientsByRelayer: vi.fn(),
  },
  horizonMock: { loadAccount: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/env", () => ({
  env: () => ({ LOG_LEVEL: "silent", STELLAR_NETWORK: "testnet" }),
  stellarPassphrase: () => "Test SDF Network ; September 2015",
  offRampTreasuryAddress: () => undefined,
}));
vi.mock("@/lib/auth", () => ({
  requireDevAuth: vi.fn(async () => ({ user: { id: "owner-1", role: "USER" } })),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/stellar/dev-mutate", () => mockRelayer);
vi.mock("@/lib/features", async (original) => ({
  ...(await original<typeof import("@/lib/features")>()),
  refuseNewFiatRecipients: vi.fn(),
}));
vi.mock("@/lib/employees", () => ({
  syncEmployees: vi.fn(),
  deriveFiatPlaceholderAddress: () => "GFIATPLACEHOLDER",
}));
vi.mock("@/lib/stellar/cash-out", () => ({
  prepareDevCashOutRecipients: vi.fn(async () => ({
    onChainRecipients: [],
    txHashes: [],
    cashOutByInputAddress: new Map(),
  })),
}));
vi.mock("@/lib/stellar/client", () => ({ horizon: () => horizonMock }));

import { NotFoundError } from "@stellar/stellar-sdk";
import { POST as payer } from "@/app/api/deployments/[id]/dev-payer/route";
import { POST as splitter } from "@/app/api/deployments/[id]/dev-splitter/route";
import { POST as subscription } from "@/app/api/deployments/[id]/dev-subscription/route";
import { clearTrustlineCache } from "@/lib/stellar/trustline-check";

const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const HAS_LINE = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const NO_LINE = "GAUF2ILE2UGAAFJZBUSICBTRMOL5TDGBZRXHYO4O5P5RMAPJ24YCV2XQ";
const USDC = { kind: "known", symbol: "USDC" };

const usdcLine = {
  asset_type: "credit_alphanum4",
  asset_code: "USDC",
  asset_issuer: ISSUER,
};
const xlmOnly = [{ asset_type: "native" }];

/** HAS_LINE trusts USDC, NO_LINE holds XLM only. */
function accountsByAddress() {
  horizonMock.loadAccount.mockImplementation(async (addr: string) => ({
    balances: addr === HAS_LINE ? [...xlmOnly, usdcLine] : xlmOnly,
  }));
}

const req = (body: unknown) => ({ json: async () => body }) as never;
const ctx = { params: Promise.resolve({ id: "dep-1" }) };

function deployment(type: "pay" | "split" | "subscription", kind: string) {
  return {
    id: "dep-1",
    graphSnapshot: { nodes: [{ id: "n1", type, config: { asset: USDC } }], edges: [] },
    pipelineSnapshot: [{ nodeId: "n1", contractAddress: "CNode", templateKind: kind }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearTrustlineCache();
  mockRelayer.updatePaymentByRelayer.mockResolvedValue({ status: "SUCCESS", txHash: "tx1" });
  mockRelayer.updateRecipientsByRelayer.mockResolvedValue({ status: "SUCCESS", txHash: "tx1" });
  mockRelayer.updateSubscriberByRelayer.mockResolvedValue({ status: "SUCCESS", txHash: "tx1" });
});

describe("dev-payer trustline warning", () => {
  beforeEach(() => mockDb.deployment.findFirst.mockResolvedValue(deployment("pay", "PAYER_DEV")));

  it("warns on a missing trustline and still runs the mutation", async () => {
    accountsByAddress();
    const res = await payer(req({ recipient: NO_LINE, mode: "fixed", amountStroops: "1" }), ctx);
    const { data } = await res.json();
    expect(res.status).toBe(200);
    expect(mockRelayer.updatePaymentByRelayer).toHaveBeenCalledTimes(1);
    expect(data.warnings).toEqual([
      expect.objectContaining({
        code: "MISSING_TRUSTLINE",
        recipient: NO_LINE,
        asset: { code: "USDC", issuer: ISSUER },
      }),
    ]);
  });

  it("gives no warning when the trustline exists", async () => {
    accountsByAddress();
    const res = await payer(req({ recipient: HAS_LINE, mode: "fixed", amountStroops: "1" }), ctx);
    expect((await res.json()).data.warnings).toEqual([]);
  });

  it("flags an unfunded account", async () => {
    horizonMock.loadAccount.mockRejectedValue(new NotFoundError("nope", {}));
    const res = await payer(req({ recipient: NO_LINE, mode: "fixed", amountStroops: "1" }), ctx);
    expect((await res.json()).data.warnings[0]).toMatchObject({ code: "MISSING_ACCOUNT" });
  });

  it("does not fail the mutation when the check errors", async () => {
    horizonMock.loadAccount.mockRejectedValue(new Error("horizon down"));
    const res = await payer(req({ recipient: NO_LINE, mode: "fixed", amountStroops: "1" }), ctx);
    expect(res.status).toBe(200);
    expect(mockRelayer.updatePaymentByRelayer).toHaveBeenCalledTimes(1);
    expect((await res.json()).data.warnings).toEqual([]);
  });

  it("does not look anything up when no recipient is being set", async () => {
    const res = await payer(req({ mode: "fixed", amountStroops: "5" }), ctx);
    expect((await res.json()).data.warnings).toEqual([]);
    expect(horizonMock.loadAccount).not.toHaveBeenCalled();
  });

  it("surfaces a failed mutation while the lookup is still pending, with no unhandled rejection", async () => {
    horizonMock.loadAccount.mockReturnValue(new Promise(() => {}));
    mockRelayer.updatePaymentByRelayer.mockRejectedValue(new Error("rpc down"));
    const res = await payer(req({ recipient: NO_LINE, mode: "fixed", amountStroops: "1" }), ctx);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("still surfaces a failed mutation as an error", async () => {
    accountsByAddress();
    mockRelayer.updatePaymentByRelayer.mockResolvedValue({ status: "FAILED", txHash: "x" });
    const res = await payer(req({ recipient: NO_LINE, mode: "fixed", amountStroops: "1" }), ctx);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("dev-splitter trustline warning", () => {
  beforeEach(() =>
    mockDb.deployment.findFirst.mockResolvedValue(deployment("split", "SPLITTER_DEV")),
  );

  it("checks every crypto recipient and warns only for those missing a trustline", async () => {
    accountsByAddress();
    const res = await splitter(
      req({
        recipients: [
          { address: HAS_LINE, mode: "percentage", bps: 5000 },
          { address: NO_LINE, mode: "percentage", bps: 5000 },
        ],
      }),
      ctx,
    );
    const { data } = await res.json();
    expect(mockRelayer.updateRecipientsByRelayer).toHaveBeenCalledTimes(1);
    expect(horizonMock.loadAccount).toHaveBeenCalledTimes(2);
    expect(data.warnings).toHaveLength(1);
    expect(data.warnings[0]).toMatchObject({ code: "MISSING_TRUSTLINE", recipient: NO_LINE });
  });

  it("warns for each recipient that lacks one", async () => {
    horizonMock.loadAccount.mockResolvedValue({ balances: xlmOnly });
    const res = await splitter(
      req({
        recipients: [
          { address: HAS_LINE, mode: "percentage", bps: 5000 },
          { address: NO_LINE, mode: "percentage", bps: 5000 },
        ],
      }),
      ctx,
    );
    const { data } = await res.json();
    expect(data.warnings.map((w: { recipient: string }) => w.recipient).sort()).toEqual(
      [HAS_LINE, NO_LINE].sort(),
    );
  });

  it("looks up only crypto recipients on a mixed crypto and fiat update", async () => {
    accountsByAddress();
    mockRelayer.submitUpdateRecipientsByRelayer.mockResolvedValue({ txHash: "tx-fiat" });
    const res = await splitter(
      req({
        recipients: [
          { address: NO_LINE, mode: "fixed", amountStroops: "1" },
          {
            mode: "fixed",
            amountStroops: "1",
            payoutMode: "fiat",
            bankDetail: { accountName: "A", accountNumber: "1", bankCode: "BASECPH" },
          },
        ],
      }),
      ctx,
    );
    const { data } = await res.json();
    expect(res.status).toBe(200);
    expect(horizonMock.loadAccount).toHaveBeenCalledTimes(1);
    expect(horizonMock.loadAccount).toHaveBeenCalledWith(NO_LINE);
    expect(data.warnings).toHaveLength(1);
  });

  it("does not fail the mutation when the check errors", async () => {
    horizonMock.loadAccount.mockRejectedValue(new Error("horizon down"));
    const res = await splitter(
      req({ recipients: [{ address: NO_LINE, mode: "percentage", bps: 10000 }] }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(mockRelayer.updateRecipientsByRelayer).toHaveBeenCalledTimes(1);
    expect((await res.json()).data.warnings).toEqual([]);
  });
});

describe("dev-subscription trustline warning", () => {
  beforeEach(() =>
    mockDb.deployment.findFirst.mockResolvedValue(deployment("subscription", "SUBSCRIPTION_DEV")),
  );

  it("warns when the subscriber has no trustline and still applies the change", async () => {
    accountsByAddress();
    const res = await subscription(req({ subscriber: NO_LINE }), ctx);
    const { data } = await res.json();
    expect(mockRelayer.updateSubscriberByRelayer).toHaveBeenCalledTimes(1);
    expect(data.warnings[0]).toMatchObject({ code: "MISSING_TRUSTLINE", recipient: NO_LINE });
  });

  it("gives no warning when the subscriber has the trustline", async () => {
    accountsByAddress();
    const res = await subscription(req({ subscriber: HAS_LINE }), ctx);
    expect((await res.json()).data.warnings).toEqual([]);
  });

  it("does not fail the mutation when the check errors", async () => {
    horizonMock.loadAccount.mockRejectedValue(new Error("horizon down"));
    const res = await subscription(req({ subscriber: NO_LINE }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).data.warnings).toEqual([]);
  });
});
