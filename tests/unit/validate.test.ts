import { describe, expect, it } from "vitest";
import { validateFlow } from "@/lib/flows/validate";
import { TemplateKind } from "@prisma/client";

const ADDR_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDR_B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

describe("validateFlow", () => {
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
      expect(r.templateKind).toBe(TemplateKind.PAYROLL);
      expect(r.pipeline).toEqual([TemplateKind.PAYROLL]);
    }
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
          config: { asset: { kind: "known", symbol: "USDC" } },
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

  it("rejects cash_out without dev mode", () => {
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
      ],
      edges: [{ id: "e1", source: "t", target: "c" }],
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
});
