import { describe, expect, it } from "vitest";
import { buildEmailContext } from "@/lib/flows/notifications";
import type { FlowGraph, FlowNode } from "@/lib/flows/schema";

const graph: FlowGraph = {
  nodes: [
    {
      id: "t",
      type: "on_receive",
      config: { asset: { kind: "known", symbol: "USDC" } },
    } as FlowNode,
    {
      id: "c",
      type: "condition",
      config: { kind: "amount_gt", amountStroops: "10000000" },
    } as FlowNode,
    {
      id: "e",
      type: "email_notify",
      config: {
        recipients: [{ address: "GAAA", email: "a@example.com" }],
        subject: "Hi",
        body: "",
      },
    } as FlowNode,
  ],
  edges: [
    { id: "e1", source: "t", target: "c" },
    { id: "e2", source: "c", target: "e" },
  ],
};

const splitGraph: FlowGraph = {
  nodes: [
    {
      id: "t",
      type: "on_receive",
      config: { asset: { kind: "known", symbol: "USDC" } },
    } as FlowNode,
    {
      id: "s",
      type: "split",
      config: {
        asset: { kind: "known", symbol: "USDC" },
        recipients: [
          { address: "GAAA", mode: "percentage", bps: 6000 },
          { address: "GBBB", mode: "percentage", bps: 4000 },
        ],
      },
    } as FlowNode,
  ],
  edges: [{ id: "e1", source: "t", target: "s" }],
};

const nativeGraph: FlowGraph = {
  nodes: [
    {
      id: "t",
      type: "on_receive",
      config: { asset: { kind: "native" } },
    } as FlowNode,
    {
      id: "e",
      type: "email_notify",
      config: {
        recipients: [{ address: "GAAA", email: "a@example.com" }],
        subject: "Hi",
        body: "",
      },
    } as FlowNode,
  ],
  edges: [{ id: "e1", source: "t", target: "e" }],
};

describe("buildEmailContext", () => {
  it("includes base event fields and walletAddress", () => {
    const ctx = buildEmailContext({
      event: {
        kind: "RECEIVE",
        ledger: 123,
        txHash: "tx",
        eventId: "ev1",
        decodedData: { amount: "5000000" },
      },
      parentNode: graph.nodes[0],
      graph,
      walletAddress: "GAAA",
    });
    expect(ctx.kind).toBe("RECEIVE");
    expect(ctx.ledger).toBe("123");
    expect(ctx.txHash).toBe("tx");
    expect(ctx.eventId).toBe("ev1");
    expect(ctx.amount).toBe("0.5");
    expect(ctx.walletAddress).toBe("GAAA");
  });

  it("adds condition variables when parent is amount_gt", () => {
    const ctx = buildEmailContext({
      event: {
        kind: "PAYOUT",
        ledger: 1,
        txHash: "tx",
        eventId: "ev1",
        decodedData: { amount: "20000000" },
      },
      parentNode: graph.nodes[1],
      graph,
      walletAddress: "GAAA",
    });
    expect(ctx.amount).toBe("2");
    expect(ctx.threshold).toBe("10000000");
    expect(ctx.condition).toBe("amount > 10000000");
    expect(ctx.walletAddress).toBe("GAAA");
  });

  it("uses explicit per-recipient amount override", () => {
    const ctx = buildEmailContext({
      event: {
        kind: "PAYOUT",
        ledger: 1,
        txHash: "tx",
        eventId: "ev1",
        decodedData: { amount: "10000000" },
      },
      parentNode: splitGraph.nodes[1],
      graph: splitGraph,
      walletAddress: "GAAA",
      amount: "6000000",
    });
    expect(ctx.amount).toBe("0.6");
    expect(ctx.walletAddress).toBe("GAAA");
  });

  it("resolves asset symbol from graph", () => {
    const ctx = buildEmailContext({
      event: {
        kind: "PAYOUT",
        ledger: 1,
        txHash: "tx",
        eventId: "ev1",
        decodedData: { amount: "10000000", asset: "USDC" },
      },
      parentNode: splitGraph.nodes[1],
      graph: splitGraph,
      walletAddress: "GAAA",
    });
    expect(ctx.asset).toBe("USDC");
  });

  it("resolves native XLM asset from parent trigger when event asset is an object", () => {
    const ctx = buildEmailContext({
      event: {
        kind: "RECEIVE",
        ledger: 1,
        txHash: "tx",
        eventId: "ev1",
        decodedData: { amount: "10000000", asset: { code: "XLM", issuer: "" } },
      },
      parentNode: nativeGraph.nodes[0],
      graph: nativeGraph,
      walletAddress: "GAAA",
    });
    expect(ctx.asset).toBe("XLM");
  });

  it("falls back recipient to walletAddress", () => {
    const ctx = buildEmailContext({
      event: {
        kind: "PAYOUT",
        ledger: 1,
        txHash: "tx",
        eventId: "ev1",
        decodedData: { amount: "10000000" },
      },
      parentNode: splitGraph.nodes[1],
      graph: splitGraph,
      walletAddress: "GAAA",
    });
    expect(ctx.recipient).toBe("GAAA");
  });

  it("prefers event recipient over walletAddress", () => {
    const ctx = buildEmailContext({
      event: {
        kind: "PAYOUT",
        ledger: 1,
        txHash: "tx",
        eventId: "ev1",
        decodedData: { amount: "10000000", recipient: "GBBB" },
      },
      parentNode: splitGraph.nodes[1],
      graph: splitGraph,
      walletAddress: "GAAA",
    });
    expect(ctx.recipient).toBe("GBBB");
  });

  it("builds shortfall context with balance, needed, and remaining", () => {
    const fixedSplit: FlowNode = {
      id: "s",
      type: "split",
      config: {
        asset: { kind: "known", symbol: "USDC" },
        recipients: [{ address: "GAAA", mode: "fixed", amountStroops: "10000000" }],
      },
    } as FlowNode;
    const ctx = buildEmailContext({
      event: {
        kind: "SHORTFALL",
        ledger: 1,
        txHash: "tx",
        eventId: "ev1",
        decodedData: {
          amount: "3000000",
          balance: "3000000",
          needed: "10000000",
          remaining: "7000000",
          asset: "USDC",
        },
      },
      parentNode: fixedSplit,
      graph: splitGraph,
      walletAddress: "GAAA",
      amount: null,
    });
    expect(ctx.amount).toBe("0.3");
    expect(ctx.balance).toBe("0.3");
    expect(ctx.needed).toBe("1");
    expect(ctx.remaining).toBe("0.7");
    expect(ctx.asset).toBe("USDC");
    expect(ctx.shortfall).toContain("Insufficient funds");
  });
});
