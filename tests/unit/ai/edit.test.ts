import { describe, expect, it } from "vitest";
import { applyPatch } from "@/lib/ai/normalize";
import {
  buildSystemPrompt,
  buildUserMessage,
  buildCorrectionPrompt,
  EditResponseSchema,
} from "@/lib/ai/prompts";
import type { FlowGraph } from "@/lib/flows/schema";

const ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const baseGraph: FlowGraph = {
  nodes: [
    { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
    {
      id: "a",
      type: "split",
      config: {
        asset: { kind: "native" },
        recipients: [
          { address: ADDR, bps: 6000, label: "Mom" },
          { address: ADDR, bps: 4000, label: "Dad" },
        ],
      },
    },
  ],
  edges: [{ id: "e1", source: "t", target: "a" }],
};

describe("applyPatch", () => {
  it("updates a node config", () => {
    const result = applyPatch(baseGraph, [
      {
        op: "updateNode",
        id: "a",
        config: {
          recipients: [
            { address: ADDR, bps: 5500, label: "Mom" },
            { address: ADDR, bps: 4500, label: "Dad" },
          ],
        },
      },
    ]);
    const split = result.nodes.find((n) => n.id === "a");
    expect(split).toBeDefined();
    expect(split!.type).toBe("split");
    expect((split!.config as { recipients: Array<{ bps: number }> }).recipients[0]!.bps).toBe(5500);
    expect((split!.config as { recipients: Array<{ bps: number }> }).recipients[1]!.bps).toBe(4500);
  });

  it("adds a node and edge", () => {
    const payNode = {
      id: "b",
      type: "pay",
      config: { recipient: ADDR, amountStroops: "100", asset: { kind: "native" } },
    };
    const result = applyPatch(baseGraph, [
      {
        op: "addNode",
        node: payNode,
        edge: { id: "e2", source: "a", target: "b" },
      },
    ]);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);
    expect(result.nodes.find((n) => n.id === "b")).toBeDefined();
  });

  it("removes a node and its edges", () => {
    const result = applyPatch(baseGraph, [{ op: "removeNode", id: "a" }]);
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
  });

  it("adds an edge", () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "pay",
          config: { recipient: ADDR, amountStroops: "100", asset: { kind: "native" } },
        },
      ],
      edges: [],
    };
    const result = applyPatch(graph, [
      { op: "addEdge", edge: { id: "e1", source: "t", target: "a" } },
    ]);
    expect(result.edges).toHaveLength(1);
  });

  it("removes an edge", () => {
    const result = applyPatch(baseGraph, [{ op: "removeEdge", id: "e1" }]);
    expect(result.edges).toHaveLength(0);
    expect(result.nodes).toHaveLength(2);
  });

  it("throws on updateNode for missing id", () => {
    expect(() => applyPatch(baseGraph, [{ op: "updateNode", id: "x", config: {} }])).toThrow(
      "updateNode: node x not found",
    );
  });

  it("throws on addNode for duplicate id", () => {
    expect(() =>
      applyPatch(baseGraph, [
        { op: "addNode", node: baseGraph.nodes[0] as Record<string, unknown>, edge: undefined },
      ]),
    ).toThrow("addNode: node t already exists");
  });

  it("throws on removeNode for missing id", () => {
    expect(() => applyPatch(baseGraph, [{ op: "removeNode", id: "x" }])).toThrow(
      "removeNode: node x not found",
    );
  });
});

describe("prompts", () => {
  it("buildSystemPrompt mentions patch operations", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("updateNode");
    expect(prompt).toContain("addNode");
    expect(prompt).toContain("removeNode");
    expect(prompt).toContain("addEdge");
    expect(prompt).toContain("removeEdge");
    expect(prompt).toContain("Pink Raft");
  });

  it("buildUserMessage includes graph and instruction", () => {
    const msg = buildUserMessage(baseGraph, "Make Mom 55%");
    expect(msg).toContain("Make Mom 55%");
    expect(msg).toContain('"t"');
    expect(msg).toContain("Current flow:");
  });
});

describe("EditResponseSchema", () => {
  it("accepts a valid patch response", () => {
    const result = EditResponseSchema.safeParse({
      explanation: "Changed Mom to 55%",
      patch: [{ op: "updateNode", id: "a", config: { recipients: [] } }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.explanation).toBe("Changed Mom to 55%");
      expect(result.data.patch).toHaveLength(1);
    }
  });

  it("rejects an unknown op", () => {
    const result = EditResponseSchema.safeParse({
      explanation: "Bad",
      patch: [{ op: "rotateNode", id: "a" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("buildCorrectionPrompt", () => {
  it("includes original instruction and validation errors", () => {
    const prompt = buildCorrectionPrompt(
      baseGraph,
      "Make Mom 55%",
      [],
      ["nodes.a.config.recipients: Recipient basis points must sum to 10000"],
    );
    expect(prompt).toContain("Make Mom 55%");
    expect(prompt).toContain("Validation errors");
    expect(prompt).toContain("10000");
    expect(prompt).toContain("corrected patch");
  });
});
