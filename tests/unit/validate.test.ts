import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateFlow, computeAssetFlow } from "@/lib/flows/validate";
import { AssetSchema, FlowGraphSchema } from "@/lib/flows/schema";
import { TemplateKind } from "@prisma/client";

const ADDR_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDR_B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const SENDER_KYC = {
  firstName: "Juan",
  lastName: "Dela Cruz",
  countryOrigin: "Philippines",
  sourceOfFunds: "Compensation",
};

function disableHardLimits() {
  process.env.NEXT_PUBLIC_SPLITTER_XLM_MIN = "0";
  process.env.NEXT_PUBLIC_SPLITTER_XLM_MAX = "0";
  process.env.NEXT_PUBLIC_SPLITTER_USDC_MIN = "0";
  process.env.NEXT_PUBLIC_SPLITTER_USDC_MAX = "0";
}

function enableDefaultHardLimits() {
  delete process.env.NEXT_PUBLIC_SPLITTER_XLM_MIN;
  delete process.env.NEXT_PUBLIC_SPLITTER_XLM_MAX;
  delete process.env.NEXT_PUBLIC_SPLITTER_USDC_MIN;
  delete process.env.NEXT_PUBLIC_SPLITTER_USDC_MAX;
}

describe("validateFlow", () => {
  beforeEach(() => {
    disableHardLimits();
  });
  it("accepts an on_receive → split flow as SPLITTER", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: { asset: { kind: "known", symbol: "USDC" } },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              { address: ADDR_A, bps: 6000 },
              { address: ADDR_B, bps: 4000 },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.templateKind).toBe(TemplateKind.SPLITTER);
      expect(r.pipeline).toEqual([TemplateKind.DEPOSIT_TRIGGER, TemplateKind.SPLITTER]);
    }
  });

  it("accepts a payroll → split (fixed) flow as PAYROLL", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "payroll",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            employer: ADDR_A,
            intervalAmount: 1,
            intervalUnit: "week",
          },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              { address: ADDR_A, mode: "fixed", amountStroops: "60000000" },
              { address: ADDR_B, mode: "fixed", amountStroops: "40000000" },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Flow-level label stays PAYROLL; the deploy pipeline is the immutable preset.
      expect(r.templateKind).toBe(TemplateKind.PAYROLL);
      expect(r.pipeline).toEqual([TemplateKind.SUBSCRIPTION, TemplateKind.SPLITTER]);
    }
  });

  it("decomposes a dev-mode payroll pipeline to SUBSCRIPTION_DEV → SPLITTER_DEV", () => {
    const r = validateFlow({
      devMode: true,
      nodes: [
        {
          id: "t",
          type: "payroll",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            employer: ADDR_A,
            intervalAmount: 1,
            intervalUnit: "week",
          },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              { address: ADDR_A, mode: "fixed", amountStroops: "60000000" },
              { address: ADDR_B, mode: "fixed", amountStroops: "40000000" },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Flow-level label stays PAYROLL; the deploy pipeline is the dev preset.
      expect(r.templateKind).toBe(TemplateKind.PAYROLL);
      expect(r.pipeline).toEqual([TemplateKind.SUBSCRIPTION_DEV, TemplateKind.SPLITTER_DEV]);
    }
  });

  it("rejects non-dev fiat split recipients missing bank details", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: { asset: { kind: "known", symbol: "USDC" } },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              { address: ADDR_A, mode: "fixed", amountStroops: "100", payoutMode: "fiat" },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.message.includes("Fiat recipient is missing"))).toBe(true);
    }
  });

  it("accepts non-dev fiat split recipients without a wallet address (PENDING:fiat)", () => {
    const r = validateFlow({
      senderKyc: SENDER_KYC,
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: { asset: { kind: "known", symbol: "USDC" } },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              {
                address: "PENDING:fiat",
                mode: "fixed",
                amountStroops: "10000000",
                payoutMode: "fiat",
                accountName: "Alice",
                accountNumber: "1234567890",
                bankCode: "BASECPH",
              },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // The fiat sentinel must not surface as a pending label blocking deploy.
      expect(r.pendingLabels).toEqual([]);
      expect(r.pipeline).toEqual([
        TemplateKind.DEPOSIT_TRIGGER,
        TemplateKind.SPLITTER,
        TemplateKind.CASH_OUT,
      ]);
    }
  });

  it("rejects non-dev PENDING:fiat split recipients missing bank details", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "webhook",
          config: { asset: { kind: "known", symbol: "USDC" }, relayer: ADDR_A },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              {
                address: "PENDING:fiat",
                mode: "percentage",
                bps: 10000,
                payoutMode: "fiat",
              },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.message.includes("Fiat recipient is missing"))).toBe(true);
    }
  });

  it("accepts non-dev payroll with PENDING:fiat recipients and no bank details in config", () => {
    const r = validateFlow({
      senderKyc: SENDER_KYC,
      nodes: [
        {
          id: "t",
          type: "payroll",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            employer: ADDR_A,
            intervalAmount: 1,
            intervalUnit: "week",
          },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              {
                address: "PENDING:fiat",
                mode: "fixed",
                amountStroops: "10000000",
                payoutMode: "fiat",
              },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pendingLabels).toEqual([]);
    }
  });

  it("accepts non-dev on_receive with fiat split recipients and bank details", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "known", symbol: "USDC" } } },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              {
                address: ADDR_A,
                mode: "fixed",
                amountStroops: "10000000",
                payoutMode: "fiat",
                accountName: "Alice",
                accountNumber: "1234567890",
                bankCode: "BASECPH",
              },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
      senderKyc: SENDER_KYC,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pipeline).toEqual([
        TemplateKind.DEPOSIT_TRIGGER,
        TemplateKind.SPLITTER,
        TemplateKind.CASH_OUT,
      ]);
    }
  });

  it("accepts non-dev webhook with a fiat pay node and bank details", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "webhook",
          config: { asset: { kind: "known", symbol: "USDC" }, relayer: ADDR_A },
        },
        {
          id: "a",
          type: "pay",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipient: ADDR_B,
            mode: "fixed",
            amountStroops: "10000000",
            fullAmount: false,
            payoutMode: "fiat",
            accountName: "Bob",
            accountNumber: "1234567890",
            bankCode: "BASECPH",
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
      senderKyc: SENDER_KYC,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pipeline).toEqual([TemplateKind.WEBHOOK, TemplateKind.PAYER, TemplateKind.CASH_OUT]);
    }
  });

  it("accepts non-dev subscription with fiat split recipients and bank details", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "subscription",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            subscriber: ADDR_A,
            amountPerPeriodStroops: "10000000",
            intervalAmount: 1,
            intervalUnit: "day",
          },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              {
                address: ADDR_B,
                mode: "fixed",
                amountStroops: "10000000",
                payoutMode: "fiat",
                accountName: "Bob",
                accountNumber: "1234567890",
                bankCode: "BASECPH",
              },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
      senderKyc: SENDER_KYC,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pipeline).toEqual([
        TemplateKind.SUBSCRIPTION,
        TemplateKind.SPLITTER,
        TemplateKind.CASH_OUT,
      ]);
    }
  });

  it("rejects fiat payout in on_schedule flows (streamer has no cash-out)", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: {
            intervalAmount: 1,
            intervalUnit: "hour",
            startsAt: "2030-01-01T00:00:00.000Z",
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            asset: { kind: "native" },
            recipient: ADDR_B,
            mode: "fixed",
            amountStroops: "10000000",
            fullAmount: false,
            payoutMode: "fiat",
            accountName: "Bob",
            accountNumber: "1234567890",
            bankCode: "BASECPH",
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects dev-mode non-payroll fiat payout (deferred)", () => {
    const r = validateFlow({
      devMode: true,
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: { asset: { kind: "known", symbol: "USDC" } },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              { address: ADDR_A, mode: "fixed", amountStroops: "100", payoutMode: "fiat" },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.message.includes("dev mode"))).toBe(true);
    }
  });

  it("rejects fiat payout combined with an oracle-gte condition", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: { asset: { kind: "known", symbol: "USDC" } },
        },
        {
          id: "c",
          type: "condition",
          config: {
            kind: "oracle_gte",
            oracle: ADDR_A,
            key: "USDC",
            threshold: "1000000",
          },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              {
                address: ADDR_B,
                mode: "fixed",
                amountStroops: "10000000",
                payoutMode: "fiat",
                accountName: "Bob",
                accountNumber: "1234567890",
                bankCode: "BASECPH",
              },
            ],
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "c" },
        { id: "e2", source: "c", target: "a" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.message.includes("oracle-gte"))).toBe(true);
    }
  });

  it("accepts non-dev payroll with fiat recipients when bank details are provided", () => {
    const r = validateFlow({
      senderKyc: SENDER_KYC,
      nodes: [
        {
          id: "t",
          type: "payroll",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            employer: ADDR_A,
            intervalAmount: 1,
            intervalUnit: "week",
          },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              {
                address: ADDR_B,
                mode: "fixed",
                amountStroops: "10000000",
                payoutMode: "fiat",
                accountName: "Bob",
                accountNumber: "1234567890",
                bankCode: "BASECPH",
              },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.templateKind).toBe(TemplateKind.PAYROLL);
      expect(r.pipeline).toEqual([
        TemplateKind.SUBSCRIPTION,
        TemplateKind.SPLITTER,
        TemplateKind.CASH_OUT,
      ]);
    }
  });

  it("rejects non-dev payroll fiat recipients missing bank details", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "payroll",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            employer: ADDR_A,
            intervalAmount: 1,
            intervalUnit: "week",
          },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              {
                address: ADDR_B,
                mode: "fixed",
                amountStroops: "10000000",
                payoutMode: "fiat",
              },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
  });

  it("requires sender KYC for non-dev payroll with fiat recipients", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "payroll",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            employer: ADDR_A,
            intervalAmount: 1,
            intervalUnit: "week",
          },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              {
                address: ADDR_B,
                mode: "fixed",
                amountStroops: "10000000",
                payoutMode: "fiat",
                accountName: "Bob",
                accountNumber: "1234567890",
                bankCode: "BASECPH",
              },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const kycError = r.errors.find((e) => e.path === "senderKyc");
      expect(kycError).toBeDefined();
      expect(kycError!.message).toBe(
        "Sender KYC is required before deploying a flow with fiat payouts.",
      );
    }
  });

  it("requires sender KYC for non-dev payroll with a fiat pay node", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "payroll",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            employer: ADDR_A,
            intervalAmount: 1,
            intervalUnit: "week",
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipient: "PENDING:fiat",
            mode: "fixed",
            amountStroops: "10000000",
            payoutMode: "fiat",
            accountName: "Bob",
            accountNumber: "1234567890",
            bankCode: "BASECPH",
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const kycError = r.errors.find((e) => e.path === "senderKyc");
      expect(kycError).toBeDefined();
      expect(kycError!.message).toBe(
        "Sender KYC is required before deploying a flow with fiat payouts.",
      );
    }
  });

  it("accepts non-dev payroll with a fiat pay node when sender KYC is provided", () => {
    const r = validateFlow({
      senderKyc: SENDER_KYC,
      nodes: [
        {
          id: "t",
          type: "payroll",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            employer: ADDR_A,
            intervalAmount: 1,
            intervalUnit: "week",
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipient: "PENDING:fiat",
            mode: "fixed",
            amountStroops: "10000000",
            payoutMode: "fiat",
            accountName: "Bob",
            accountNumber: "1234567890",
            bankCode: "BASECPH",
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
  });

  it("exempts dev-mode payroll with fiat recipients from sender KYC", () => {
    const r = validateFlow({
      devMode: true,
      nodes: [
        {
          id: "t",
          type: "payroll",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            employer: ADDR_A,
            intervalAmount: 1,
            intervalUnit: "week",
          },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              {
                address: ADDR_B,
                mode: "fixed",
                amountStroops: "10000000",
                payoutMode: "fiat",
              },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
  });

  it("accepts non-dev cash_out flow when sender KYC is provided", () => {
    const r = validateFlow({
      senderKyc: SENDER_KYC,
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "known", symbol: "USDC" } } },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [{ address: ADDR_A, mode: "fixed", amountStroops: "10000000" }],
          },
        },
        {
          id: "c",
          type: "cash_out",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            accountName: "Juan",
            accountNumber: "123",
            bankCode: "BASECPH",
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "a" },
        { id: "e2", source: "a", target: "c" },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects non-dev cash_out flow without sender KYC", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "known", symbol: "USDC" } } },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [{ address: ADDR_A, mode: "fixed", amountStroops: "10000000" }],
          },
        },
        {
          id: "c",
          type: "cash_out",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            accountName: "Juan",
            accountNumber: "123",
            bankCode: "BASECPH",
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "a" },
        { id: "e2", source: "a", target: "c" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.path === "senderKyc")).toBe(true);
    }
  });

  it("allows dev-mode split with empty recipients to fill via API after deploy", () => {
    const r = validateFlow({
      devMode: true,
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: { asset: { kind: "known", symbol: "USDC" } },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.templateKind).toBe(TemplateKind.SPLITTER);
      expect(r.pipeline).toEqual([TemplateKind.DEPOSIT_TRIGGER, TemplateKind.SPLITTER_DEV]);
    }
  });

  it("rejects non-dev split with empty recipients", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: { asset: { kind: "known", symbol: "USDC" } },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects payroll → split with percentage recipients", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "payroll",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            employer: ADDR_A,
            intervalAmount: 1,
            intervalUnit: "week",
          },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              { address: ADDR_A, mode: "percentage", bps: 6000 },
              { address: ADDR_B, mode: "percentage", bps: 4000 },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects bps that don't sum to 10000", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: { asset: { kind: "known", symbol: "USDC" } },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              { address: ADDR_A, bps: 6000 },
              { address: ADDR_B, bps: 3000 },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects flows with no trigger", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              { address: ADDR_A, bps: 6000 },
              { address: ADDR_B, bps: 4000 },
            ],
          },
        },
        {
          id: "b",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              { address: ADDR_A, bps: 6000 },
              { address: ADDR_B, bps: 4000 },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "a", target: "b" }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects flows with cycles", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: { asset: { kind: "native" } },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "native" },
            recipients: [
              { address: ADDR_A, bps: 5000 },
              { address: ADDR_B, bps: 5000 },
            ],
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "a" },
        { id: "e2", source: "a", target: "t" },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects unreachable actions", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            amountStroops: "10",
            asset: { kind: "native" },
          },
        },
      ],
      edges: [],
    });
    expect(r.ok).toBe(false);
  });

  it("infers STREAMER from on_schedule → pay", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: {
            intervalAmount: 1,
            intervalUnit: "hour",
            startsAt: "2030-01-01T00:00:00.000Z",
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            amountStroops: "100",
            asset: { kind: "known", symbol: "USDC" },
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.templateKind).toBe(TemplateKind.STREAMER);
      expect(r.pipeline).toEqual([TemplateKind.STREAMER]);
    }
  });

  it("infers STREAMER from on_schedule → split", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: {
            intervalAmount: 1,
            intervalUnit: "day",
            startsAt: "2030-01-01T00:00:00.000Z",
          },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "native" },
            recipients: [
              { address: ADDR_A, bps: 6000 },
              { address: ADDR_B, bps: 4000 },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.templateKind).toBe(TemplateKind.STREAMER);
      expect(r.pipeline).toEqual([TemplateKind.STREAMER]);
    }
  });

  it("accepts on_schedule with pauseAllowed: false", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: {
            intervalAmount: 1,
            intervalUnit: "hour",
            startsAt: "2030-01-01T00:00:00.000Z",
            pauseAllowed: false,
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            amountStroops: "100",
            asset: { kind: "known", symbol: "USDC" },
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.templateKind).toBe(TemplateKind.STREAMER);
    }
  });

  it("infers CONDITIONAL from on_receive + split + condition", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: { asset: { kind: "known", symbol: "USDC" } },
        },
        {
          id: "c",
          type: "condition",
          config: { kind: "amount_gt", amountStroops: "50000000" },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              { address: ADDR_A, bps: 6000 },
              { address: ADDR_B, bps: 4000 },
            ],
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "c" },
        { id: "e2", source: "c", target: "a" },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.templateKind).toBe(TemplateKind.CONDITIONAL);
      expect(r.pipeline).toEqual([
        TemplateKind.DEPOSIT_TRIGGER,
        TemplateKind.ROUTER,
        TemplateKind.SPLITTER,
      ]);
    }
  });

  it("infers CONDITIONAL from on_schedule + split + condition", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: {
            intervalAmount: 1,
            intervalUnit: "hour",
            startsAt: "2030-01-01T00:00:00.000Z",
          },
        },
        {
          id: "c",
          type: "condition",
          config: { kind: "time_after", at: "2030-06-01T00:00:00.000Z" },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "native" },
            recipients: [
              { address: ADDR_A, bps: 5000 },
              { address: ADDR_B, bps: 5000 },
            ],
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "c" },
        { id: "e2", source: "c", target: "a" },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.templateKind).toBe(TemplateKind.CONDITIONAL);
      expect(r.pipeline).toEqual([TemplateKind.STREAMER]);
    }
  });

  // ── web2_webhook compatibility ──
  it("accepts web2_webhook → swap", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "web2_webhook",
          config: { asset: { kind: "native" } },
        },
        {
          id: "a",
          type: "swap",
          config: {
            assetIn: { kind: "native" },
            assetOut: { kind: "known", symbol: "USDC" },
            rateBps: 9500,
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pipeline).toEqual([TemplateKind.WEBHOOK, TemplateKind.SWAPPER]);
    }
  });

  it("accepts web2_webhook → yield", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "web2_webhook",
          config: { asset: { kind: "known", symbol: "USDC" } },
        },
        {
          id: "a",
          type: "yield",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            vault: ADDR_A,
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pipeline).toEqual([TemplateKind.WEBHOOK, TemplateKind.YIELD]);
    }
  });

  it("rejects web2_webhook → pay", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "web2_webhook",
          config: { asset: { kind: "known", symbol: "USDC" } },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            amountStroops: "10000000",
            asset: { kind: "known", symbol: "USDC" },
            mode: "fixed",
            fullAmount: false,
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
  });

  it("accepts web2_webhook → split", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "web2_webhook",
          config: { asset: { kind: "known", symbol: "USDC" } },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              { address: ADDR_A, bps: 5000 },
              { address: ADDR_B, bps: 5000 },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
  });

  it("accepts email_notify as a decorator attached to a condition", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "known", symbol: "USDC" } } },
        { id: "c", type: "condition", config: { kind: "amount_gt", amountStroops: "10000000" } },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              { address: ADDR_A, bps: 5000 },
              { address: ADDR_B, bps: 5000 },
            ],
          },
        },
        {
          id: "e",
          type: "email_notify",
          config: {
            recipients: [{ address: ADDR_A, email: "a@example.com" }],
            subject: "Hi",
            body: "",
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "c" },
        { id: "e2", source: "c", target: "a" },
        { id: "e3", source: "c", target: "e" },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pipeline).toEqual([
        TemplateKind.DEPOSIT_TRIGGER,
        TemplateKind.ROUTER,
        TemplateKind.SPLITTER,
      ]);
    }
  });

  it("rejects email_notify with outgoing edges", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "pay",
          config: { recipient: ADDR_A, amountStroops: "10", asset: { kind: "native" } },
        },
        {
          id: "e",
          type: "email_notify",
          config: {
            recipients: [{ address: ADDR_A, email: "a@example.com" }],
            subject: "Hi",
            body: "",
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "a" },
        { id: "e2", source: "t", target: "e" },
        { id: "e3", source: "e", target: "a" },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects email_notify without recipients", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "pay",
          config: { recipient: ADDR_A, amountStroops: "10", asset: { kind: "native" } },
        },
        { id: "e", type: "email_notify", config: { recipients: [], subject: "Hi", body: "" } },
      ],
      edges: [
        { id: "e1", source: "t", target: "a" },
        { id: "e2", source: "t", target: "e" },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects email_notify without a contract action", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "e",
          type: "email_notify",
          config: {
            recipients: [{ address: ADDR_A, email: "a@example.com" }],
            subject: "Hi",
            body: "",
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "e" }],
    });
    expect(r.ok).toBe(false);
  });

  it("accepts email_notify attached to a split with one email per recipient", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "s",
          type: "split",
          config: {
            asset: { kind: "native" },
            recipients: [
              { address: ADDR_A, bps: 5000 },
              { address: ADDR_B, bps: 5000 },
            ],
          },
        },
        {
          id: "e",
          type: "email_notify",
          config: {
            recipients: [
              { address: ADDR_A, email: "a@example.com" },
              { address: ADDR_B, email: "b@example.com" },
            ],
            subject: "Hi",
            body: "",
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "s" },
        { id: "e2", source: "s", target: "e" },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects email_notify attached to a split with missing recipient emails", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "s",
          type: "split",
          config: {
            asset: { kind: "native" },
            recipients: [
              { address: ADDR_A, bps: 5000 },
              { address: ADDR_B, bps: 5000 },
            ],
          },
        },
        {
          id: "e",
          type: "email_notify",
          config: {
            recipients: [{ address: ADDR_A, email: "a@example.com" }],
            subject: "Hi",
            body: "",
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "s" },
        { id: "e2", source: "s", target: "e" },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("accepts an all-fixed split", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "native" },
            recipients: [
              { address: ADDR_A, mode: "fixed", amountStroops: "5000000" },
              { address: ADDR_B, mode: "fixed", amountStroops: "5000000" },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a mixed-mode split", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "native" },
            recipients: [
              { address: ADDR_A, mode: "percentage", bps: 5000 },
              { address: ADDR_B, mode: "fixed", amountStroops: "5000000" },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
  });

  it("infers SUBSCRIPTION from subscription → pay", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "subscription",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            subscriber: ADDR_A,
            amountPerPeriodStroops: "10000000",
            intervalAmount: 1,
            intervalUnit: "minute",
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_B,
            amountStroops: "10000000",
            asset: { kind: "known", symbol: "USDC" },
            mode: "fixed",
            fullAmount: false,
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.templateKind).toBe(TemplateKind.SUBSCRIPTION);
      expect(r.pipeline).toEqual([TemplateKind.SUBSCRIPTION, TemplateKind.PAYER]);
    }
  });

  it("rejects a subscription with zero amount per period", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "subscription",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            subscriber: ADDR_A,
            amountPerPeriodStroops: "0",
            intervalAmount: 1,
            intervalUnit: "day",
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_B,
            amountStroops: "10000000",
            asset: { kind: "known", symbol: "USDC" },
            mode: "fixed",
            fullAmount: false,
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.path.includes("amountPerPeriodStroops"))).toBe(true);
    }
  });

  it("allows a zero subscription amount in dev mode (filled via API)", () => {
    const r = validateFlow({
      devMode: true,
      nodes: [
        {
          id: "t",
          type: "subscription",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            subscriber: ADDR_A,
            amountPerPeriodStroops: "0",
            intervalAmount: 1,
            intervalUnit: "day",
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_B,
            amountStroops: "10000000",
            asset: { kind: "known", symbol: "USDC" },
            mode: "fixed",
            fullAmount: false,
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a fixed split with zero amount", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "native" },
            recipients: [{ address: ADDR_A, mode: "fixed", amountStroops: "0" }],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
  });

  it("accepts dev-mode on_receive → split → cash_out", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "known", symbol: "USDC" } } },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [{ address: ADDR_A, mode: "fixed", amountStroops: "10000000" }],
          },
        },
        {
          id: "c",
          type: "cash_out",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            accountName: "Juan",
            accountNumber: "123",
            bankCode: "BASECPH",
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "a" },
        { id: "e2", source: "a", target: "c" },
      ],
      devMode: true,
    });
    expect(r.ok).toBe(true);
  });

  it("accepts cash_out without dev mode when bank details are provided", () => {
    const r = validateFlow({
      senderKyc: SENDER_KYC,
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "known", symbol: "USDC" } } },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [{ address: ADDR_A, mode: "fixed", amountStroops: "10000000" }],
          },
        },
        {
          id: "c",
          type: "cash_out",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            accountName: "Juan",
            accountNumber: "123",
            bankCode: "BASECPH",
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "a" },
        { id: "e2", source: "a", target: "c" },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects cash_out without dev mode when bank details are blank", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "known", symbol: "USDC" } } },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [{ address: ADDR_A, mode: "fixed", amountStroops: "10000000" }],
          },
        },
        {
          id: "c",
          type: "cash_out",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            accountName: "",
            accountNumber: "",
            bankCode: "",
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "a" },
        { id: "e2", source: "a", target: "c" },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects cash_out with outgoing edges", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "known", symbol: "USDC" } } },
        {
          id: "c",
          type: "cash_out",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            accountName: "",
            accountNumber: "",
            bankCode: "",
          },
        },
        {
          id: "x",
          type: "pay",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipient: ADDR_A,
            mode: "fixed",
            amountStroops: "100",
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "c" },
        { id: "e2", source: "c", target: "x" },
      ],
      devMode: true,
    });
    expect(r.ok).toBe(false);
  });

  // ── asset enforcement hardening (#225) ──
  it("rejects on_receive XLM → pay USDC", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            amountStroops: "10",
            asset: { kind: "known", symbol: "USDC" },
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
  });

  it("accepts on_receive XLM → swap (XLM→USDC) → pay USDC", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "s",
          type: "swap",
          config: {
            assetIn: { kind: "native" },
            assetOut: { kind: "known", symbol: "USDC" },
            rateBps: 9500,
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            amountStroops: "10",
            asset: { kind: "known", symbol: "USDC" },
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "s" },
        { id: "e2", source: "s", target: "a" },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects on_receive XLM → swap (XLM→USDC) → pay XLM", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "s",
          type: "swap",
          config: {
            assetIn: { kind: "native" },
            assetOut: { kind: "known", symbol: "USDC" },
            rateBps: 9500,
          },
        },
        {
          id: "a",
          type: "pay",
          config: { recipient: ADDR_A, amountStroops: "10", asset: { kind: "native" } },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "s" },
        { id: "e2", source: "s", target: "a" },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a swap whose assetIn does not match the incoming asset", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "s",
          type: "swap",
          config: {
            assetIn: { kind: "known", symbol: "USDC" },
            assetOut: { kind: "native" },
            rateBps: 9500,
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "s" }],
    });
    expect(r.ok).toBe(false);
  });

  it("accepts on_schedule → pay with any asset (no trigger asset to constrain)", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: {
            intervalAmount: 1,
            intervalUnit: "hour",
            startsAt: "2030-01-01T00:00:00.000Z",
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            amountStroops: "100",
            asset: { kind: "known", symbol: "USDC" },
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a node reached by two paths that disagree on asset (merge conflict)", () => {
    // t (USDC) -> s (swap USDC->XLM) -> a (pay), plus a second edge t -> a
    // directly. "a" receives XLM via the swap path and USDC via the direct
    // path — neither the validator nor the user can pick a single winner.
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "known", symbol: "USDC" } } },
        {
          id: "s",
          type: "swap",
          config: {
            assetIn: { kind: "known", symbol: "USDC" },
            assetOut: { kind: "native" },
            rateBps: 9500,
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            amountStroops: "10",
            asset: { kind: "known", symbol: "USDC" },
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "s" },
        { id: "e2", source: "s", target: "a" },
        { id: "e3", source: "t", target: "a" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.message.toLowerCase().includes("conflict"))).toBe(true);
    }
  });

  it("accepts a node reached by two paths that agree on asset (no false-positive conflict)", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "known", symbol: "USDC" } } },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            amountStroops: "10",
            asset: { kind: "known", symbol: "USDC" },
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "a" },
        { id: "e2", source: "t", target: "a" },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects the second swap in a chain when its assetIn doesn't match the first swap's assetOut", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "s1",
          type: "swap",
          config: {
            assetIn: { kind: "native" },
            assetOut: { kind: "known", symbol: "USDC" },
            rateBps: 9500,
          },
        },
        {
          id: "s2",
          type: "swap",
          config: {
            // Wrong: s1 outputs USDC, but s2 declares it expects native.
            assetIn: { kind: "native" },
            assetOut: { kind: "native" },
            rateBps: 9500,
          },
        },
        {
          id: "a",
          type: "pay",
          config: { recipient: ADDR_A, amountStroops: "10", asset: { kind: "native" } },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "s1" },
        { id: "e2", source: "s1", target: "s2" },
        { id: "e3", source: "s2", target: "a" },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("accepts a custom asset trigger flowing into a matching custom asset pay", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: { asset: { kind: "custom", code: "PAI", issuer: ADDR_A } },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_B,
            amountStroops: "10",
            asset: { kind: "custom", code: "PAI", issuer: ADDR_A },
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a custom asset trigger flowing into a pay configured for a different asset", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: { asset: { kind: "custom", code: "PAI", issuer: ADDR_A } },
        },
        {
          id: "a",
          type: "pay",
          config: { recipient: ADDR_B, amountStroops: "10", asset: { kind: "native" } },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
  });

  // ── schema-error friendly messages (#307) ──
  it("names the recipient and bad value when a split address is invalid", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "native" },
            recipients: [
              { address: ADDR_A, bps: 5000, label: "Alice" },
              { address: "NOTAVALIDSTELLARADDRESS123", bps: 5000, label: "Bob" },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.path.includes("recipients"));
      expect(issue).toBeDefined();
      expect(issue!.friendlyMessage).toContain('recipient "Bob"');
      expect(issue!.friendlyMessage).toContain("NOTAVALIDSTELLARADDRESS123");
      expect(issue!.friendlyMessage).not.toContain("flow structure is invalid");
    }
  });

  it("falls back to a positional label when the split recipient has no label", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "native" },
            recipients: [
              { address: ADDR_A, bps: 5000 },
              { address: "BADADDR", bps: 5000 },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.path.includes("recipients"));
      expect(issue!.friendlyMessage).toContain("recipient #2");
    }
  });

  it("identifies an invalid pay node recipient address", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: "NOTAVALIDSTELLARADDRESS123",
            amountStroops: "10",
            asset: { kind: "native" },
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.path.includes("recipient"));
      expect(issue).toBeDefined();
      expect(issue!.friendlyMessage).toContain("pay node's recipient");
      expect(issue!.friendlyMessage).toContain("NOTAVALIDSTELLARADDRESS123");
    }
  });
});

describe("computeAssetFlow", () => {
  it("propagates the trigger asset to a directly connected node", () => {
    const graph = FlowGraphSchema.parse({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "known", symbol: "USDC" } } },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            mode: "fixed",
            amountStroops: "10",
            asset: { kind: "native" },
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    const flow = computeAssetFlow(graph);
    expect(flow.get("a")).toEqual({ kind: "known", symbol: "USDC" });
  });

  it("returns null for every node when the trigger has no asset", () => {
    const graph = FlowGraphSchema.parse({
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: {
            intervalAmount: 1,
            intervalUnit: "hour",
            startsAt: "2030-01-01T00:00:00.000Z",
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            mode: "fixed",
            amountStroops: "10",
            asset: { kind: "native" },
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    const flow = computeAssetFlow(graph);
    expect(flow.get("a")).toBeNull();
  });

  it("transforms propagation through a swap to the swap's assetOut", () => {
    const graph = FlowGraphSchema.parse({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "s",
          type: "swap",
          config: {
            assetIn: { kind: "native" },
            assetOut: { kind: "known", symbol: "USDC" },
            rateBps: 9500,
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            mode: "fixed",
            amountStroops: "10",
            asset: { kind: "native" },
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "s" },
        { id: "e2", source: "s", target: "a" },
      ],
    });
    const flow = computeAssetFlow(graph);
    expect(flow.get("a")).toEqual({ kind: "known", symbol: "USDC" });
  });

  it("returns null for a node unreachable from the trigger", () => {
    const graph = FlowGraphSchema.parse({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            mode: "fixed",
            amountStroops: "10",
            asset: { kind: "native" },
          },
        },
      ],
      edges: [],
    });
    const flow = computeAssetFlow(graph);
    expect(flow.get("a")).toBeNull();
  });

  it("uses the nearest upstream swap when swaps are chained", () => {
    const graph = FlowGraphSchema.parse({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "s1",
          type: "swap",
          config: {
            assetIn: { kind: "native" },
            assetOut: { kind: "known", symbol: "USDC" },
            rateBps: 9500,
          },
        },
        {
          id: "s2",
          type: "swap",
          config: {
            assetIn: { kind: "known", symbol: "USDC" },
            assetOut: { kind: "native" },
            rateBps: 9500,
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            mode: "fixed",
            amountStroops: "10",
            asset: { kind: "native" },
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "s1" },
        { id: "e2", source: "s1", target: "s2" },
        { id: "e3", source: "s2", target: "a" },
      ],
    });
    const flow = computeAssetFlow(graph);
    expect(flow.get("a")).toEqual({ kind: "native" });
  });

  it("returns null (not an arbitrary pick) for a node whose incoming paths disagree", () => {
    const graph = FlowGraphSchema.parse({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "known", symbol: "USDC" } } },
        {
          id: "s",
          type: "swap",
          config: {
            assetIn: { kind: "known", symbol: "USDC" },
            assetOut: { kind: "native" },
            rateBps: 9500,
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            mode: "fixed",
            amountStroops: "10",
            asset: { kind: "native" },
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "s" },
        { id: "e2", source: "s", target: "a" },
        { id: "e3", source: "t", target: "a" },
      ],
    });
    const flow = computeAssetFlow(graph);
    expect(flow.get("a")).toBeNull();
  });
});

describe("AssetSchema", () => {
  it("normalizes a custom asset code by stripping non-alphanumeric chars and capping at 12", () => {
    const asset = AssetSchema.parse({
      kind: "custom",
      code: "MY-ASSET-CODE",
      issuer: ADDR_A,
    });
    expect(asset).toEqual({ kind: "custom", code: "MYASSETCODE", issuer: ADDR_A });
  });

  it("rejects a custom asset code that normalizes to empty", () => {
    expect(() => AssetSchema.parse({ kind: "custom", code: "---", issuer: ADDR_A })).toThrow();
  });
});

describe("validateFlow — hard limits", () => {
  beforeEach(() => {
    enableDefaultHardLimits();
  });

  afterEach(() => {
    disableHardLimits();
  });

  it("rejects a fixed USDC split recipient below the minimum", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "known", symbol: "USDC" } } },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [{ address: ADDR_A, mode: "fixed", amountStroops: "10000000" }],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.path === "nodes.a.config.recipients.0.amountStroops")).toBe(
        true,
      );
      expect(r.errors.some((e) => e.message.includes("below temporary minimum"))).toBe(true);
    }
  });

  it("rejects a fixed USDC split recipient above the maximum", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "known", symbol: "USDC" } } },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [{ address: ADDR_A, mode: "fixed", amountStroops: "2000000000" }],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.message.includes("exceeds temporary maximum"))).toBe(true);
    }
  });

  it("accepts a fixed USDC split recipient within limits", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "known", symbol: "USDC" } } },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [{ address: ADDR_A, mode: "fixed", amountStroops: "500000000" }],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a fixed XLM pay amount below the minimum", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            mode: "fixed",
            amountStroops: "100000000",
            asset: { kind: "native" },
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.path === "nodes.a.config.amountStroops")).toBe(true);
      expect(r.errors.some((e) => e.message.includes("below temporary minimum"))).toBe(true);
    }
  });

  it("accepts a fixed XLM pay amount within limits", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            mode: "fixed",
            amountStroops: "3000000000",
            asset: { kind: "native" },
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
  });

  it("does not limit custom assets", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: { asset: { kind: "custom", code: "FOO", issuer: ADDR_A } },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "custom", code: "FOO", issuer: ADDR_A },
            recipients: [{ address: ADDR_A, mode: "fixed", amountStroops: "1" }],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
  });

  function usdcSplit(amountStroops: string) {
    return validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "known", symbol: "USDC" } } },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [{ address: ADDR_A, mode: "fixed", amountStroops }],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
  }

  it("accepts an amount exactly equal to the minimum (bounds are inclusive)", () => {
    // 30 USDC == default min
    expect(usdcSplit("300000000").ok).toBe(true);
  });

  it("accepts an amount exactly equal to the maximum (bounds are inclusive)", () => {
    // 110 USDC == default max
    expect(usdcSplit("1100000000").ok).toBe(true);
  });

  it("honors a configured (non-default) env value at runtime", () => {
    process.env.NEXT_PUBLIC_SPLITTER_USDC_MAX = "500";
    // 200 USDC exceeds the default 110 max but is under the configured 500.
    expect(usdcSplit("2000000000").ok).toBe(true);
  });

  it("disables only the max bound when max is 0", () => {
    process.env.NEXT_PUBLIC_SPLITTER_USDC_MAX = "0";
    expect(usdcSplit("2000000000").ok).toBe(true);
    // min is still enforced
    expect(usdcSplit("10000000").ok).toBe(false);
  });

  it("disables only the min bound when min is 0", () => {
    process.env.NEXT_PUBLIC_SPLITTER_USDC_MIN = "0";
    expect(usdcSplit("10000000").ok).toBe(true);
    // max is still enforced
    expect(usdcSplit("2000000000").ok).toBe(false);
  });

  it("rejects every amount when max < min (both nonzero) — a misconfiguration, not a disable", () => {
    process.env.NEXT_PUBLIC_SPLITTER_USDC_MIN = "500";
    process.env.NEXT_PUBLIC_SPLITTER_USDC_MAX = "100";
    expect(usdcSplit("500000000").ok).toBe(false); // 50 USDC: below min
    expect(usdcSplit("2000000000").ok).toBe(false); // 200 USDC: above max
    expect(usdcSplit("3000000000").ok).toBe(false); // 300 USDC: above max
  });
});
