import { describe, expect, it } from "vitest";
import { flowToEnglish } from "@/lib/flows/english";

const ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDR_B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

describe("flowToEnglish", () => {
  it("describes a 60/30/10 split", () => {
    const out = flowToEnglish({
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
              { address: ADDR, mode: "percentage", bps: 6000, label: "Alice" },
              { address: ADDR, mode: "percentage", bps: 3000, label: "Bob" },
              { address: ADDR_B, mode: "percentage", bps: 1000, label: "Charlie" },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(out).toContain("receives USDC");
    expect(out).toContain("60% to Alice");
    expect(out).toContain("30% to Bob");
    expect(out).toContain("10% to Charlie");
  });

  it("describes a split with minAmountStroops trigger", () => {
    const out = flowToEnglish({
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: {
            asset: { kind: "native" },
            minAmountStroops: "50000000",
          },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "native" },
            recipients: [
              { address: ADDR, mode: "percentage", bps: 5000, label: "A" },
              { address: ADDR_B, mode: "percentage", bps: 5000, label: "B" },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(out).toContain("receives ≥ 5 XLM");
    expect(out).toContain("50% (2.5 XLM) to A");
    expect(out).toContain("50% (2.5 XLM) to B");
  });

  it("shows projected amounts when source amount is known", () => {
    const out = flowToEnglish({
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            minAmountStroops: "10000000", // 1 USDC
          },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              { address: ADDR, mode: "percentage", bps: 6000, label: "Savings" },
              { address: ADDR_B, mode: "percentage", bps: 4000, label: "Spending" },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(out).toContain("60% (0.6 USDC) to Savings");
    expect(out).toContain("40% (0.4 USDC) to Spending");
  });

  it("describes a streamer", () => {
    const out = flowToEnglish({
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: { intervalAmount: 1, intervalUnit: "hour", startsAt: "2030-01-01T00:00:00.000Z" },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR,
            amountStroops: "20000000",
            asset: { kind: "native" },
            mode: "fixed",
            fullAmount: false,
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(out).toContain("every hour");
    expect(out).toContain("pay 2 XLM");
  });

  it("formats an on_schedule start as a readable date, not a raw ISO timestamp", () => {
    const out = flowToEnglish({
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: {
            intervalAmount: 1,
            intervalUnit: "hour",
            startsAt: "2026-06-25T05:25:13.993Z",
            timeZone: "UTC",
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR,
            amountStroops: "20000000",
            asset: { kind: "native" },
            mode: "fixed",
            fullAmount: false,
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(out).toContain("every hour starting June 25, 2026 at 5:25 AM");
    expect(out).not.toContain("2026-06-25T05:25:13.993Z");
    expect(out).not.toContain("T05:25");
  });

  it("describes a scheduled split (streamer)", () => {
    const out = flowToEnglish({
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: { intervalAmount: 1, intervalUnit: "day", startsAt: "2030-01-01T00:00:00.000Z" },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "native" },
            amountPerIntervalStroops: "10",
            recipients: [
              { address: ADDR, mode: "percentage", bps: 6000, label: "A" },
              { address: ADDR_B, mode: "percentage", bps: 4000, label: "B" },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(out).toContain("every day");
    expect(out).toContain("stream 0.000001 XLM per interval");
    expect(out).toContain("60% to A");
    expect(out).toContain("40% to B");
  });

  it("describes a fixed split", () => {
    const out = flowToEnglish({
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
              { address: ADDR, mode: "fixed", amountStroops: "10000000", label: "Alice" },
              { address: ADDR_B, mode: "fixed", amountStroops: "5000000", label: "Bob" },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(out).toContain("receives USDC");
    expect(out).toContain("1 USDC to Alice");
    expect(out).toContain("0.5 USDC to Bob");
  });

  it("describes a flow with condition", () => {
    const out = flowToEnglish({
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: { asset: { kind: "native" } },
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
            asset: { kind: "native" },
            recipients: [{ address: ADDR, mode: "percentage", bps: 10000, label: "Recipient" }],
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "c" },
        { id: "e2", source: "c", target: "a" },
      ],
    });
    expect(out).toContain("only if amount ≥ 5 XLM");
  });

  it("describes a pay node with percentage mode", () => {
    const out = flowToEnglish({
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: { asset: { kind: "known", symbol: "USDC" } },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR,
            asset: { kind: "known", symbol: "USDC" },
            mode: "percentage",
            percentage: 25,
            fullAmount: false,
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(out).toContain("pay 25% of incoming USDC");
  });

  it("describes a pay node with fullAmount", () => {
    const out = flowToEnglish({
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: { asset: { kind: "native" } },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR,
            asset: { kind: "native" },
            mode: "fixed",
            fullAmount: true,
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(out).toContain("pay full incoming XLM");
  });

  it("describes a web2_webhook → swap flow", () => {
    const out = flowToEnglish({
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
    expect(out).toContain("When HTTP webhook fires for USDC");
    expect(out).toContain("swap XLM to USDC at 95% rate");
  });

  it("describes a subscription trigger with interval", () => {
    const out = flowToEnglish({
      nodes: [
        {
          id: "t",
          type: "subscription",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            subscriber: ADDR,
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
    expect(out).toContain("When subscription pulls 1 USDC every minute");
    expect(out).toContain("pay 1 USDC");
  });

  it("describes a subscription trigger with plural interval", () => {
    const out = flowToEnglish({
      nodes: [
        {
          id: "t",
          type: "subscription",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            subscriber: ADDR,
            amountPerPeriodStroops: "10000000",
            intervalAmount: 5,
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
    expect(out).toContain("When subscription pulls 1 USDC every 5 days");
  });

  it("describes a dev-mode payroll trigger with API-filled employer and schedule", () => {
    const out = flowToEnglish({
      devMode: true,
      nodes: [
        {
          id: "t",
          type: "payroll",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            employer: "PENDING:__api__",
            intervalAmount: 5,
            intervalUnit: "minute",
            fillScheduleViaApi: true,
          },
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
    expect(out).toContain("When payroll pulls from (employer set via API) (schedule set via API)");
    expect(out).not.toContain("every 5 minutes");
  });

  it("uses account name for fiat split recipients", () => {
    const out = flowToEnglish({
      nodes: [
        {
          id: "t",
          type: "payroll",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            employer: ADDR,
            intervalAmount: 1,
            intervalUnit: "week",
            fillScheduleViaApi: false,
          },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              {
                address: "PENDING",
                mode: "fixed",
                amountStroops: "10000000",
                label: "Alice",
                payoutMode: "fiat",
                accountName: "Alice Savings",
                accountNumber: "123456",
                bankCode: "BOA",
              },
              {
                address: ADDR_B,
                mode: "fixed",
                amountStroops: "5000000",
                label: "Bob",
                payoutMode: "crypto",
              },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(out).toContain("1 USDC to Alice Savings");
    expect(out).not.toContain("(needs address)");
    expect(out).toContain("0.5 USDC to Bob");
  });

  it("includes the total fixed distribution as the payroll pull amount", () => {
    const out = flowToEnglish({
      nodes: [
        {
          id: "t",
          type: "payroll",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            employer: ADDR,
            intervalAmount: 1,
            intervalUnit: "week",
            fillScheduleViaApi: false,
          },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              { address: ADDR, mode: "fixed", amountStroops: "10000000", label: "Alice" },
              { address: ADDR_B, mode: "fixed", amountStroops: "5000000", label: "Bob" },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(out).toContain("When payroll pulls 1.5 USDC from");
    expect(out).toContain("every week");
    expect(out).toContain("split 1 USDC to Alice, 0.5 USDC to Bob");
  });
});
