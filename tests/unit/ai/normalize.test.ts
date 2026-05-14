import { describe, it, expect } from "vitest";
import { normalizeFlowGraph } from "@/lib/ai/normalize";
import type { FlowGraph } from "@/lib/flows/schema";

const ADDR1 = "GAO5RJ6BZJY5DZISYWNS3AOPET4J6PJT6EAEOYDWAY6YRWCQ6VH4OSYB";
const ADDR2 = "GAVKZEC2UC3VU7QV7SUOAQXYCOYSSA62IFYZF54GBP7A565NBSOT6EZB";
const ISSUER = "GDRMOPRWHQWIDDK3P4YXWJF74HTBFCNIPG6YD6KC6BYOAA6W4W5XOIQW";

describe("normalizeFlowGraph", () => {
  it("normalizes a simple splitter flow", () => {
    const raw = {
      nodes: [
        { id: "n1", type: "on_receive", data: { asset: "USDC" } },
        {
          id: "n2",
          type: "split",
          data: {
            asset: "USDC",
            recipients: [
              { address: ADDR1, bps: 5000, label: "Mom" },
              { address: ADDR2, bps: 5000, label: "Savings" },
            ],
          },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
    };

    const result = normalizeFlowGraph(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.nodes).toHaveLength(2);
    expect(result.graph.nodes[0]).toMatchObject({
      id: "n1",
      type: "on_receive",
      config: { asset: { kind: "known", symbol: "USDC" } },
    });
    expect(result.graph.nodes[1]).toMatchObject({
      id: "n2",
      type: "split",
      config: {
        asset: { kind: "known", symbol: "USDC" },
        recipients: [
          { address: ADDR1, bps: 5000, label: "Mom" },
          { address: ADDR2, bps: 5000, label: "Savings" },
        ],
      },
    });
    expect(result.graph.edges).toHaveLength(1);
    expect(result.graph.edges[0]).toMatchObject({ source: "n1", target: "n2" });
  });

  it("normalizes a streamer flow", () => {
    const raw = {
      nodes: [
        {
          id: "n1",
          type: "on_schedule",
          data: { interval: "day", startsAt: "2026-05-14T00:00:00Z" },
        },
        {
          id: "n2",
          type: "pay",
          data: {
            asset: "USDC",
            recipient: ADDR1,
            amount: "1000000000",
          },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
    };

    const result = normalizeFlowGraph(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.nodes).toHaveLength(2);
    expect(result.graph.nodes[0]).toMatchObject({
      id: "n1",
      type: "on_schedule",
      config: { interval: "day", startsAt: "2026-05-14T00:00:00Z" },
    });
    expect(result.graph.nodes[1]).toMatchObject({
      id: "n2",
      type: "pay",
      config: {
        asset: { kind: "known", symbol: "USDC" },
        recipient: ADDR1,
        amountStroops: "1000000000",
      },
    });
  });

  it("normalizes XLM asset", () => {
    const raw = {
      nodes: [
        { id: "n1", type: "on_receive", data: { asset: "XLM" } },
        { id: "n2", type: "pay", data: { asset: "xlm", recipient: ADDR1, amount: "100" } },
      ],
      edges: [{ source: "n1", target: "n2" }],
    };

    const result = normalizeFlowGraph(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.nodes[0]!.config).toMatchObject({ asset: { kind: "native" } });
    expect(result.graph.nodes[1]!.config).toMatchObject({ asset: { kind: "native" } });
  });

  it("normalizes custom asset", () => {
    const raw = {
      nodes: [
        {
          id: "n1",
          type: "on_receive",
          data: { asset: { code: "MYT", issuer: ISSUER } },
        },
        {
          id: "n2",
          type: "pay",
          data: { asset: "USDC", recipient: ADDR1, amount: "100" },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
    };

    const result = normalizeFlowGraph(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.nodes[0]!.config).toMatchObject({
      asset: { kind: "custom", code: "MYT", issuer: ISSUER },
    });
  });

  it("normalizes condition node", () => {
    const raw = {
      nodes: [
        { id: "n1", type: "on_receive", data: { asset: "USDC" } },
        { id: "n2", type: "condition", data: { kind: "amount_gt", amount: "1000000000" } },
        { id: "n3", type: "pay", data: { asset: "USDC", recipient: ADDR1, amount: "500" } },
      ],
      edges: [
        { source: "n1", target: "n2" },
        { source: "n2", target: "n3" },
      ],
    };

    const result = normalizeFlowGraph(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.nodes[1]).toMatchObject({
      id: "n2",
      type: "condition",
      config: { kind: "amount_gt", amountStroops: "1000000000" },
    });
  });

  it("generates edge ids when missing", () => {
    const raw = {
      nodes: [
        { id: "n1", type: "on_receive", data: { asset: "USDC" } },
        { id: "n2", type: "pay", data: { asset: "USDC", recipient: ADDR1, amount: "100" } },
      ],
      edges: [{ source: "n1", target: "n2" }],
    };

    const result = normalizeFlowGraph(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.edges[0]!.id).toBe("e0");
  });

  it("accepts config instead of data", () => {
    const raw = {
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "USDC" } },
        { id: "n2", type: "pay", config: { asset: "USDC", recipient: ADDR1, amount: "100" } },
      ],
      edges: [{ source: "n1", target: "n2" }],
    };

    const result = normalizeFlowGraph(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.nodes[0]!.config).toMatchObject({
      asset: { kind: "known", symbol: "USDC" },
    });
  });

  it("auto-generates edges when missing", () => {
    const raw = {
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "USDC" } },
        {
          id: "n2",
          type: "split",
          config: {
            asset: "USDC",
            recipients: [
              { address: ADDR1, bps: 5000, label: "A" },
              { address: ADDR2, bps: 5000, label: "B" },
            ],
          },
        },
      ],
      edges: [],
    };

    const result = normalizeFlowGraph(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.edges).toHaveLength(1);
    expect(result.graph.edges[0]).toMatchObject({ source: "n1", target: "n2" });
  });

  it("normalizes bps that don't sum to 10000", () => {
    const raw = {
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "USDC" } },
        {
          id: "n2",
          type: "split",
          config: {
            asset: "USDC",
            recipients: [
              { address: ADDR1, bps: 60, label: "A" },
              { address: ADDR2, bps: 30, label: "B" },
              { address: ADDR1, bps: 10, label: "C" },
            ],
          },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
    };

    const result = normalizeFlowGraph(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const splitNode = result.graph.nodes[1] as Extract<
      (typeof result.graph.nodes)[number],
      { type: "split" }
    >;
    const sum = splitNode.config.recipients.reduce((s, r) => s + r.bps, 0);
    expect(sum).toBe(10000);
  });

  it("adds missing recipient if only one provided", () => {
    const raw = {
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "USDC" } },
        {
          id: "n2",
          type: "split",
          config: { asset: "USDC", recipients: [{ address: ADDR1, bps: 10000, label: "A" }] },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
    };

    const result = normalizeFlowGraph(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const splitNode = result.graph.nodes[1] as Extract<
      (typeof result.graph.nodes)[number],
      { type: "split" }
    >;
    expect(splitNode.config.recipients.length).toBeGreaterThanOrEqual(2);
  });

  it("normalizes compact asset strings like 10usdc", () => {
    const raw = {
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "10usdc" } },
        { id: "n2", type: "pay", config: { asset: "100 USDC", recipient: ADDR1, amount: "100" } },
        { id: "n3", type: "pay", config: { asset: "10xlm", recipient: ADDR1, amount: "100" } },
      ],
      edges: [{ source: "n1", target: "n2" }],
    };

    const result = normalizeFlowGraph(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.nodes[0]!.config).toMatchObject({
      asset: { kind: "known", symbol: "USDC" },
    });
    expect(result.graph.nodes[1]!.config).toMatchObject({
      asset: { kind: "known", symbol: "USDC" },
    });
    expect(result.graph.nodes[2]!.config).toMatchObject({
      asset: { kind: "native" },
    });
  });

  it("normalizes custom asset codes to uppercase", () => {
    const raw = {
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "mytoken" } },
        { id: "n2", type: "pay", config: { asset: "mytoken", recipient: ADDR1, amount: "100" } },
      ],
      edges: [{ source: "n1", target: "n2" }],
    };

    const result = normalizeFlowGraph(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.nodes[0]!.config).toMatchObject({
      asset: { kind: "custom", code: "MYTOKEN", issuer: ADDR1 },
    });
  });

  it("returns error for invalid input", () => {
    const r1 = normalizeFlowGraph(null);
    expect(r1.ok).toBe(false);
    if (r1.ok) return;
    expect(r1.error).toContain("not an object");

    const r2 = normalizeFlowGraph({ nodes: [], edges: [] });
    expect(r2.ok).toBe(false);
  });
});
