import { describe, expect, it } from "vitest";
import { TemplateKind } from "@prisma/client";
import { flowToParams } from "@/lib/flows/to-params";
import { sourceAmountStroops, bpsToPct, pctToBps } from "@/lib/flows/schema";

const ADDR_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDR_B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

function splitGraph(opts?: { minAmount?: string; condition?: boolean; rate?: string }) {
  const nodes: Array<Record<string, unknown>> = [
    {
      id: "t",
      type: "on_receive",
      config: {
        asset: { kind: "known", symbol: "USDC" } as const,
        ...(opts?.minAmount ? { minAmountStroops: opts.minAmount } : {}),
      },
    },
  ];
  const edges: Array<{ id: string; source: string; target: string }> = [];

  if (opts?.condition) {
    nodes.push({
      id: "c",
      type: "condition",
      config: { kind: "amount_gt", amountStroops: "50000000" },
    });
    edges.push({ id: "e0", source: "t", target: "c" });
  }

  nodes.push({
    id: "a",
    type: "split",
    config: {
      asset: { kind: "known", symbol: "USDC" } as const,
      recipients: [
        { address: ADDR_A, bps: 6000, label: "Mom" },
        { address: ADDR_B, bps: 4000, label: "Car" },
      ],
      ...(opts?.rate ? { ratePerSecondStroops: opts.rate } : {}),
    },
  });

  const lastNode = opts?.condition ? "c" : "t";
  edges.push({ id: "e1", source: lastNode, target: "a" });

  return { nodes, edges } as const;
}

function scheduleSplitGraph(opts?: { condition?: boolean; rate?: string }) {
  const nodes: Array<Record<string, unknown>> = [
    {
      id: "t",
      type: "on_schedule",
      config: {
        interval: "hour" as const,
        startsAt: "2030-01-01T00:00:00.000Z",
      },
    },
  ];
  const edges: Array<{ id: string; source: string; target: string }> = [];

  if (opts?.condition) {
    nodes.push({
      id: "c",
      type: "condition",
      config: { kind: "time_after", at: "2030-06-01T00:00:00.000Z" },
    });
    edges.push({ id: "e0", source: "t", target: "c" });
  }

  nodes.push({
    id: "a",
    type: "split",
    config: {
      asset: { kind: "native" } as const,
      recipients: [
        { address: ADDR_A, bps: 6000, label: "A" },
        { address: ADDR_B, bps: 4000, label: "B" },
      ],
      ...(opts?.rate ? { ratePerSecondStroops: opts.rate } : {}),
    },
  });

  const lastNode = opts?.condition ? "c" : "t";
  edges.push({ id: "e1", source: lastNode, target: "a" });

  return { nodes, edges } as const;
}

describe("flowToParams", () => {
  // ── SPLITTER ──
  it("produces splitter params (on_receive → split)", () => {
    const out = flowToParams(
      splitGraph() as Parameters<typeof flowToParams>[0],
      TemplateKind.SPLITTER,
    );
    expect(out.kind).toBe("splitter");
    if (out.kind === "splitter") {
      expect(out.recipients).toHaveLength(2);
      expect(out.recipients[0]!.bps).toBe(6000);
      expect(out.recipients[1]!.bps).toBe(4000);
    }
  });

  it("produces splitter params with minAmountStroops", () => {
    const out = flowToParams(
      splitGraph({ minAmount: "50000000" }) as Parameters<typeof flowToParams>[0],
      TemplateKind.SPLITTER,
    );
    expect(out.kind).toBe("splitter");
    if (out.kind === "splitter") {
      expect(out.minAmountStroops).toBe("50000000");
    }
  });

  it("produces splitter params from pay-through (on_receive → pay)", () => {
    const out = flowToParams(
      {
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
              recipient: ADDR_A,
              amountStroops: "1000",
              asset: { kind: "native" },
            },
          },
        ],
        edges: [{ id: "e", source: "t", target: "a" }],
      },
      TemplateKind.SPLITTER,
    );
    expect(out.kind).toBe("splitter");
    if (out.kind === "splitter") {
      expect(out.recipients).toHaveLength(1);
      expect(out.recipients[0]!.bps).toBe(10000);
    }
  });

  // ── STREAMER ──
  it("produces streamer params (on_schedule → pay)", () => {
    const out = flowToParams(
      {
        nodes: [
          {
            id: "t",
            type: "on_schedule",
            config: { interval: "hour", startsAt: "2030-01-01T00:00:00.000Z" },
          },
          {
            id: "a",
            type: "pay",
            config: {
              recipient: ADDR_A,
              amountStroops: "1000",
              asset: { kind: "native" },
            },
          },
        ],
        edges: [{ id: "e", source: "t", target: "a" }],
      },
      TemplateKind.STREAMER,
    );
    expect(out.kind).toBe("streamer");
    if (out.kind === "streamer") {
      expect(out.recipients).toHaveLength(1);
      expect(out.recipients[0]!.address).toBe(ADDR_A);
      expect(out.recipients[0]!.bps).toBe(10000);
      expect(out.ratePerSecondStroops).toBe("1000");
      expect(out.endTs).toBeGreaterThan(out.startTs);
    }
  });

  it("produces streamer params for scheduled split", () => {
    const out = flowToParams(
      scheduleSplitGraph({ rate: "500" }) as Parameters<typeof flowToParams>[0],
      TemplateKind.STREAMER,
    );
    expect(out.kind).toBe("streamer");
    if (out.kind === "streamer") {
      expect(out.recipients).toHaveLength(2);
      expect(out.recipients[0]!.bps).toBe(6000);
      expect(out.recipients[1]!.bps).toBe(4000);
      expect(out.ratePerSecondStroops).toBe("500");
      expect(out.endTs).toBeGreaterThan(out.startTs);
    }
  });

  // ── CONDITIONAL ──
  it("produces conditional params (on_receive + condition → pay)", () => {
    const out = flowToParams(
      {
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
            type: "pay",
            config: {
              recipient: ADDR_A,
              amountStroops: "10000000",
              asset: { kind: "known", symbol: "USDC" },
            },
          },
        ],
        edges: [
          { id: "e1", source: "t", target: "c" },
          { id: "e2", source: "c", target: "a" },
        ],
      },
      TemplateKind.CONDITIONAL,
    );
    expect(out.kind).toBe("conditional");
    if (out.kind === "conditional") {
      expect(out.recipients).toHaveLength(1);
      expect(out.recipients[0]!.bps).toBe(10000);
      expect(out.amountStroops).toBe("10000000");
      expect(out.condition).toEqual({ kind: "amount_gt", amountStroops: "50000000" });
    }
  });

  it("produces conditional params for split with condition (on_receive + condition → split)", () => {
    const out = flowToParams(
      splitGraph({ condition: true }) as Parameters<typeof flowToParams>[0],
      TemplateKind.CONDITIONAL,
    );
    expect(out.kind).toBe("conditional");
    if (out.kind === "conditional") {
      expect(out.recipients).toHaveLength(2);
      expect(out.recipients[0]!.bps).toBe(6000);
      expect(out.recipients[1]!.bps).toBe(4000);
      expect(out.condition).toEqual({ kind: "amount_gt", amountStroops: "50000000" });
      // source amount comes from the condition's amount_gt
      expect(out.amountStroops).toBe("50000000");
    }
  });

  it("produces conditional params for scheduled split with condition", () => {
    const out = flowToParams(
      scheduleSplitGraph({ condition: true }) as Parameters<typeof flowToParams>[0],
      TemplateKind.CONDITIONAL,
    );
    expect(out.kind).toBe("conditional");
    if (out.kind === "conditional") {
      expect(out.recipients).toHaveLength(2);
      expect(out.condition).toEqual({
        kind: "time_after",
        at: "2030-06-01T00:00:00.000Z",
      });
    }
  });

  it("produces conditional params for on_schedule + condition → pay", () => {
    const out = flowToParams(
      {
        nodes: [
          {
            id: "t",
            type: "on_schedule",
            config: { interval: "day", startsAt: "2030-01-01T00:00:00.000Z" },
          },
          {
            id: "c",
            type: "condition",
            config: { kind: "oracle_gte", oracle: ADDR_A, key: "price", threshold: "100" },
          },
          {
            id: "a",
            type: "pay",
            config: {
              recipient: ADDR_B,
              amountStroops: "500",
              asset: { kind: "native" },
            },
          },
        ],
        edges: [
          { id: "e1", source: "t", target: "c" },
          { id: "e2", source: "c", target: "a" },
        ],
      },
      TemplateKind.CONDITIONAL,
    );
    expect(out.kind).toBe("conditional");
    if (out.kind === "conditional") {
      expect(out.amountStroops).toBe("500");
      expect(out.condition).toEqual({
        kind: "oracle_gte",
        oracle: ADDR_A,
        key: "price",
        threshold: "100",
      });
    }
  });

  it("uses trigger minAmountStroops as source for conditional split", () => {
    const graph = splitGraph({ minAmount: "50000000", condition: true });
    // override condition to not be amount-based so we get trigger's min amount
    (graph.nodes[1] as Record<string, unknown>).config = {
      kind: "time_after",
      at: "2030-01-01T00:00:00.000Z",
    };
    const out = flowToParams(graph as Parameters<typeof flowToParams>[0], TemplateKind.CONDITIONAL);
    expect(out.kind).toBe("conditional");
    if (out.kind === "conditional") {
      expect(out.amountStroops).toBe("50000000");
    }
  });
});

describe("bps helpers", () => {
  it("converts bps to pct", () => {
    expect(bpsToPct(10000)).toBe(100);
    expect(bpsToPct(5000)).toBe(50);
    expect(bpsToPct(3333)).toBe(33.33);
    expect(bpsToPct(100)).toBe(1);
  });

  it("converts pct to bps", () => {
    expect(pctToBps(100)).toBe(10000);
    expect(pctToBps(50)).toBe(5000);
    expect(pctToBps(33.33)).toBe(3333);
    expect(pctToBps(1)).toBe(100);
  });

  it("is lossless for whole percentages", () => {
    for (let pct = 0; pct <= 100; pct++) {
      expect(bpsToPct(pctToBps(pct))).toBe(pct);
    }
  });
});

describe("sourceAmountStroops", () => {
  it("reads from on_receive trigger minAmountStroops", () => {
    const out = sourceAmountStroops({
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: {
            asset: { kind: "native" },
            minAmountStroops: "50000000",
          },
        },
      ],
      edges: [],
    });
    expect(out).toBe("50000000");
  });

  it("reads from amount_gt condition", () => {
    const out = sourceAmountStroops({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "c",
          type: "condition",
          config: { kind: "amount_gt", amountStroops: "10000000" },
        },
      ],
      edges: [],
    });
    expect(out).toBe("10000000");
  });

  it("reads from amount_lt condition", () => {
    const out = sourceAmountStroops({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "c",
          type: "condition",
          config: { kind: "amount_lt", amountStroops: "20000000" },
        },
      ],
      edges: [],
    });
    expect(out).toBe("20000000");
  });

  it("returns undefined when no source amount", () => {
    const out = sourceAmountStroops({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "c",
          type: "condition",
          config: { kind: "time_after", at: "2030-01-01T00:00:00.000Z" },
        },
      ],
      edges: [],
    });
    expect(out).toBeUndefined();
  });
});
