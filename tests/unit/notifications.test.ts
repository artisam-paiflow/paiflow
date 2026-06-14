import { describe, expect, it } from "vitest";
import { buildEmailContext, interpolateTemplate } from "@/lib/flows/notifications";
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
      config: { to: ["a@example.com"], subject: "Hi", body: "" },
    } as FlowNode,
  ],
  edges: [
    { id: "e1", source: "t", target: "c" },
    { id: "e2", source: "c", target: "e" },
  ],
};

describe("buildEmailContext", () => {
  it("includes base event fields", () => {
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
    });
    expect(ctx.kind).toBe("RECEIVE");
    expect(ctx.ledger).toBe("123");
    expect(ctx.txHash).toBe("tx");
    expect(ctx.eventId).toBe("ev1");
    expect(ctx.amount).toBe("5000000");
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
    });
    expect(ctx.amount).toBe("20000000");
    expect(ctx.threshold).toBe("10000000");
    expect(ctx.condition).toBe("amount ≥ 10000000");
  });
});

describe("interpolateTemplate", () => {
  it("replaces known variables", () => {
    const out = interpolateTemplate("Amount: {{amount}} {{asset}}", {
      amount: "100",
      asset: "USDC",
    });
    expect(out).toBe("Amount: 100 USDC");
  });

  it("leaves unknown variables intact", () => {
    const out = interpolateTemplate("{{amount}} {{missing}}", { amount: "100" });
    expect(out).toBe("100 {{missing}}");
  });
});
