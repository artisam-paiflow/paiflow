import { describe, expect, it, vi } from "vitest";
import { TemplateKind } from "@prisma/client";
import { flowToParams, flowToPipeline } from "@/lib/flows/to-params";
import { sourceAmountStroops, bpsToPct, pctToBps } from "@/lib/flows/schema";

const ADDR_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDR_B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

function splitGraph(opts?: {
  minAmount?: string;
  condition?: boolean;
  amountPerInterval?: string;
}) {
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
        { address: ADDR_A, bps: 6000, label: "Alice" },
        { address: ADDR_B, bps: 4000, label: "Bob" },
      ],
      ...(opts?.amountPerInterval ? { amountPerIntervalStroops: opts.amountPerInterval } : {}),
    },
  });

  const lastNode = opts?.condition ? "c" : "t";
  edges.push({ id: "e1", source: lastNode, target: "a" });

  return { nodes, edges } as const;
}

function scheduleSplitGraph(opts?: { condition?: boolean; amountPerInterval?: string }) {
  const nodes: Array<Record<string, unknown>> = [
    {
      id: "t",
      type: "on_schedule",
      config: {
        intervalAmount: 1,
        intervalUnit: "hour" as const,
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
      ...(opts?.amountPerInterval ? { amountPerIntervalStroops: opts.amountPerInterval } : {}),
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
              mode: "fixed",
              fullAmount: false,
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
              amountStroops: "3600000",
              asset: { kind: "native" },
              mode: "fixed",
              fullAmount: false,
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
      expect(out.amountPerIntervalStroops).toBe("3600000");
      expect(out.intervalSeconds).toBe(3600);
      expect(out.endTs).toBeGreaterThan(out.startTs);
    }
  });

  it("produces streamer params for scheduled split", () => {
    const out = flowToParams(
      scheduleSplitGraph({ amountPerInterval: "500" }) as Parameters<typeof flowToParams>[0],
      TemplateKind.STREAMER,
    );
    expect(out.kind).toBe("streamer");
    if (out.kind === "streamer") {
      expect(out.recipients).toHaveLength(2);
      expect(out.recipients[0]!.bps).toBe(6000);
      expect(out.recipients[1]!.bps).toBe(4000);
      expect(out.amountPerIntervalStroops).toBe("500");
      expect(out.intervalSeconds).toBe(3600);
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
              mode: "fixed",
              fullAmount: false,
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
            config: {
              intervalAmount: 1,
              intervalUnit: "day",
              startsAt: "2030-01-01T00:00:00.000Z",
            },
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
              mode: "fixed",
              fullAmount: false,
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
  it("excludes email_notify from pipeline mapping", () => {
    const pipeline = flowToPipeline({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            amountStroops: "100",
            asset: { kind: "native" },
            mode: "fixed",
            fullAmount: false,
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
        { id: "e1", source: "t", target: "a" },
        { id: "e2", source: "t", target: "e" },
      ],
    });
    expect(pipeline).toHaveLength(2);
    expect(pipeline.map((n) => n.nodeId)).toEqual(["t", "a"]);
  });

  it("keeps email_notify out of nextStepNodeIds", () => {
    const pipeline = flowToPipeline({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            amountStroops: "100",
            asset: { kind: "native" },
            mode: "fixed",
            fullAmount: false,
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
        { id: "e1", source: "t", target: "a" },
        { id: "e2", source: "t", target: "e" },
      ],
    });
    const trigger = pipeline.find((n) => n.params.kind === "deposit_trigger");
    expect(trigger!.params).toMatchObject({
      nextStepNodeIds: ["a"],
    });
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

describe("flowToPipeline", () => {
  it("produces deposit_trigger → splitter for on_receive → split", () => {
    const pipeline = flowToPipeline(splitGraph() as Parameters<typeof flowToPipeline>[0]);
    expect(pipeline).toHaveLength(2);
    expect(pipeline[0]!.templateKind).toBe("DEPOSIT_TRIGGER");
    expect(pipeline[0]!.params.kind).toBe("deposit_trigger");
    expect(pipeline[1]!.templateKind).toBe("SPLITTER");
    expect(pipeline[1]!.params.kind).toBe("splitter");
    expect(pipeline[1]!.params).toMatchObject({
      asset: { kind: "known", symbol: "USDC" },
      recipients: [
        { address: ADDR_A, bps: 6000 },
        { address: ADDR_B, bps: 4000 },
      ],
      minAmountStroops: "0",
    });
  });

  it("produces deposit_trigger → timelock → splitter for time_after condition", () => {
    const graph = splitGraph() as Parameters<typeof flowToPipeline>[0];
    graph.nodes.push({
      id: "c",
      type: "condition",
      config: { kind: "time_after", at: "2030-06-01T00:00:00.000Z" },
    });
    graph.edges.push({ id: "e0", source: "t", target: "c" });
    graph.edges.push({ id: "e1", source: "c", target: "a" });
    // Remove direct edge from trigger to action
    graph.edges = graph.edges.filter((e) => !(e.source === "t" && e.target === "a"));

    const pipeline = flowToPipeline(graph);
    expect(pipeline).toHaveLength(3);
    expect(pipeline[0]!.templateKind).toBe("DEPOSIT_TRIGGER");
    expect(pipeline[1]!.templateKind).toBe("TIMELOCK");
    expect(pipeline[1]!.params.kind).toBe("timelock");
    expect(pipeline[2]!.templateKind).toBe("SPLITTER");
  });

  it("produces deposit_trigger → router → splitter for amount_gt condition", () => {
    const graph = splitGraph({ condition: true }) as Parameters<typeof flowToPipeline>[0];
    // Override condition to amount_gt
    (graph.nodes[1] as Record<string, unknown>).config = {
      kind: "amount_gt",
      amountStroops: "50000000",
    };
    const pipeline = flowToPipeline(graph);
    expect(pipeline).toHaveLength(3);
    expect(pipeline[0]!.templateKind).toBe("DEPOSIT_TRIGGER");
    expect(pipeline[1]!.templateKind).toBe("ROUTER");
    expect(pipeline[1]!.params.kind).toBe("router");
    expect(pipeline[1]!.params).toMatchObject({
      threshold: "50000000",
      pathANodeIds: ["a"],
      pathBNodeIds: [],
    });
    expect(pipeline[2]!.templateKind).toBe("SPLITTER");
  });

  it("produces deposit_trigger → conditional for oracle_gte condition", () => {
    const graph = {
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: { asset: { kind: "native" } },
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
    } as Parameters<typeof flowToPipeline>[0];

    const pipeline = flowToPipeline(graph);
    expect(pipeline).toHaveLength(2);
    expect(pipeline[0]!.templateKind).toBe("DEPOSIT_TRIGGER");
    expect(pipeline[1]!.templateKind).toBe("CONDITIONAL");
    expect(pipeline[1]!.params.kind).toBe("conditional");
    expect(pipeline[1]!.params).toMatchObject({
      amountStroops: "500",
      nextStepNodeIds: ["a"],
    });
  });

  it("produces standalone streamer for on_schedule → pay", () => {
    const pipeline = flowToPipeline({
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
            recipient: ADDR_A,
            amountStroops: "3600000",
            asset: { kind: "native" },
            mode: "fixed",
            fullAmount: false,
          },
        },
      ],
      edges: [{ id: "e", source: "t", target: "a" }],
    });
    expect(pipeline).toHaveLength(1);
    expect(pipeline[0]!.templateKind).toBe("STREAMER");
    expect(pipeline[0]!.params.kind).toBe("streamer");
  });

  it("converts pay amount to amount per interval for on_schedule streamer", () => {
    const pipeline = flowToPipeline({
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: {
            intervalAmount: 1,
            intervalUnit: "minute",
            startsAt: "2030-01-01T00:00:00.000Z",
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            amountStroops: "60000",
            asset: { kind: "native" },
            mode: "fixed",
            fullAmount: false,
          },
        },
      ],
      edges: [{ id: "e", source: "t", target: "a" }],
    });
    expect(pipeline).toHaveLength(1);
    const streamer = pipeline[0]!.params as {
      kind: string;
      amountPerIntervalStroops: string;
      intervalSeconds: number;
    };
    expect(streamer.kind).toBe("streamer");
    expect(streamer.amountPerIntervalStroops).toBe("60000");
    expect(streamer.intervalSeconds).toBe(60);
  });

  it("wires nextStepNodeIds from graph edges", () => {
    const pipeline = flowToPipeline(splitGraph() as Parameters<typeof flowToPipeline>[0]);
    const trigger = pipeline.find((n) => n.params.kind === "deposit_trigger");
    expect(trigger!.params).toMatchObject({
      kind: "deposit_trigger",
      nextStepNodeIds: ["a"],
    });
  });

  it("maps pay node with percentage mode", () => {
    const pipeline = flowToPipeline({
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
            asset: { kind: "native" },
            mode: "percentage",
            percentage: 50,
            fullAmount: false,
          },
        },
      ],
      edges: [{ id: "e", source: "t", target: "a" }],
    });
    expect(pipeline).toHaveLength(2);
    const payer = pipeline.find((n) => n.params.kind === "payer");
    expect(payer).toBeDefined();
    expect(payer!.params).toMatchObject({
      kind: "payer",
      mode: "percentage",
      percentageBps: 5000,
      amountStroops: "0",
      recipient: ADDR_A,
    });
  });

  it("maps pay node with fullAmount", () => {
    const pipeline = flowToPipeline({
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
            asset: { kind: "native" },
            mode: "fixed",
            fullAmount: true,
          },
        },
      ],
      edges: [{ id: "e", source: "t", target: "a" }],
    });
    expect(pipeline).toHaveLength(2);
    const payer = pipeline.find((n) => n.params.kind === "payer");
    expect(payer).toBeDefined();
    expect(payer!.params).toMatchObject({
      kind: "payer",
      mode: "percentage",
      percentageBps: 10000,
      amountStroops: "0",
      recipient: ADDR_A,
    });
  });

  it("maps web2_webhook to WEBHOOK with app relayer address", () => {
    const RELAYER = "GAPPG3VDBPONOHRYQL6D7XIVZFDZDXCC2QE3CBTN2GDRBMOBMSAT6TQK";
    const pipeline = flowToPipeline(
      {
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
        edges: [{ id: "e", source: "t", target: "a" }],
      },
      RELAYER,
    );
    expect(pipeline).toHaveLength(2);
    expect(pipeline[0]!.templateKind).toBe("WEBHOOK");
    expect(pipeline[0]!.params.kind).toBe("webhook_trigger");
    expect(pipeline[0]!.params).toMatchObject({
      relayer: RELAYER,
      asset: { kind: "known", symbol: "USDC" },
      nextStepNodeIds: ["a"],
    });
    expect(pipeline[1]!.templateKind).toBe("SWAPPER");
  });

  it("uses placeholder relayer when web2_webhook is mapped without relayerAddress", () => {
    const pipeline = flowToPipeline({
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
      edges: [{ id: "e", source: "t", target: "a" }],
    });
    expect(pipeline).toHaveLength(2);
    expect(pipeline[0]!.templateKind).toBe("WEBHOOK");
    const triggerParams = pipeline[0]!.params as { kind: string; relayer: string };
    expect(triggerParams.kind).toBe("webhook_trigger");
    expect(triggerParams.relayer).toBe("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWH2");
  });

  it("converts 2 XLM per minute for 5 occurrences to correct streamer params", () => {
    const pipeline = flowToPipeline({
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: {
            intervalAmount: 1,
            intervalUnit: "minute",
            startsAt: "2030-01-01T00:00:00.000Z",
            occurrences: 5,
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            amountStroops: "20000000",
            asset: { kind: "native" },
            mode: "fixed",
            fullAmount: false,
          },
        },
      ],
      edges: [{ id: "e", source: "t", target: "a" }],
    });
    expect(pipeline).toHaveLength(1);
    const streamer = pipeline[0]!.params as {
      kind: string;
      amountPerIntervalStroops: string;
      intervalSeconds: number;
      startTs: number;
      endTs: number;
    };
    expect(streamer.kind).toBe("streamer");
    // 2 XLM is the amount released each 60-second interval.
    expect(streamer.amountPerIntervalStroops).toBe("20000000");
    expect(streamer.intervalSeconds).toBe(60);
    // 5 occurrences * 1 minute = 5 minutes
    expect(streamer.endTs - streamer.startTs).toBe(5 * 60);
    // After 3 minutes exactly 3 intervals have vested => 6 XLM
    const vestedAfter3Min = BigInt(streamer.amountPerIntervalStroops) * 3n;
    expect(vestedAfter3Min).toBe(60_000_000n);
  });

  it("computes endTs from occurrences and intervalAmount/intervalUnit", () => {
    const pipeline = flowToPipeline({
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: {
            intervalAmount: 2,
            intervalUnit: "hour",
            startsAt: "2030-01-01T00:00:00.000Z",
            occurrences: 5,
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            amountStroops: "1000",
            asset: { kind: "native" },
            mode: "fixed",
            fullAmount: false,
          },
        },
      ],
      edges: [{ id: "e", source: "t", target: "a" }],
    });
    expect(pipeline).toHaveLength(1);
    const streamer = pipeline[0]!.params as { kind: string; startTs: number; endTs: number };
    expect(streamer.kind).toBe("streamer");
    expect(streamer.endTs - streamer.startTs).toBe(5 * 2 * 3600);
  });

  it("computes endTs from occurrences with legacy interval field", () => {
    const pipeline = flowToPipeline({
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: {
            intervalAmount: 1,
            intervalUnit: "day",
            startsAt: "2030-01-01T00:00:00.000Z",
            occurrences: 3,
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            amountStroops: "1000",
            asset: { kind: "native" },
            mode: "fixed",
            fullAmount: false,
          },
        },
      ],
      edges: [{ id: "e", source: "t", target: "a" }],
    });
    const streamer = pipeline[0]!.params as { kind: string; startTs: number; endTs: number };
    expect(streamer.endTs - streamer.startTs).toBe(3 * 86400);
  });

  it("prefers endsAt over occurrences", () => {
    const pipeline = flowToPipeline({
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: {
            intervalAmount: 1,
            intervalUnit: "hour",
            startsAt: "2030-01-01T00:00:00.000Z",
            endsAt: "2030-01-15T00:00:00.000Z",
            occurrences: 5,
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            amountStroops: "1000",
            asset: { kind: "native" },
            mode: "fixed",
            fullAmount: false,
          },
        },
      ],
      edges: [{ id: "e", source: "t", target: "a" }],
    });
    const streamer = pipeline[0]!.params as { kind: string; startTs: number; endTs: number };
    expect(streamer.endTs - streamer.startTs).toBe(14 * 86400);
  });

  it("clamps on_schedule startTs to now when startsAt is in the past", () => {
    const now = new Date("2030-01-01T12:00:00.000Z").getTime();
    vi.setSystemTime(now);

    const pipeline = flowToPipeline({
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: {
            intervalAmount: 1,
            intervalUnit: "minute",
            // 10 minutes in the past relative to the mocked "now"
            startsAt: "2030-01-01T11:50:00.000Z",
            occurrences: 5,
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR_A,
            amountStroops: "20000000",
            asset: { kind: "native" },
            mode: "fixed",
            fullAmount: false,
          },
        },
      ],
      edges: [{ id: "e", source: "t", target: "a" }],
    });

    const streamer = pipeline[0]!.params as {
      kind: string;
      startTs: number;
      endTs: number;
    };
    expect(streamer.kind).toBe("streamer");
    expect(streamer.startTs).toBe(Math.floor(now / 1000));
    // Duration is still computed from occurrences * interval, not from the
    // original (now-past) startsAt.
    expect(streamer.endTs - streamer.startTs).toBe(5 * 60);

    vi.useRealTimers();
  });
});
