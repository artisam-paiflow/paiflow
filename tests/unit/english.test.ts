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
              { address: ADDR, bps: 6000, label: "Alice" },
              { address: ADDR, bps: 3000, label: "Bob" },
              { address: ADDR_B, bps: 1000, label: "Charlie" },
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
              { address: ADDR, bps: 5000, label: "A" },
              { address: ADDR_B, bps: 5000, label: "B" },
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
              { address: ADDR, bps: 6000, label: "Savings" },
              { address: ADDR_B, bps: 4000, label: "Spending" },
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
              { address: ADDR, bps: 6000, label: "A" },
              { address: ADDR_B, bps: 4000, label: "B" },
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
            recipients: [{ address: ADDR, bps: 10000, label: "Recipient" }],
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
});
