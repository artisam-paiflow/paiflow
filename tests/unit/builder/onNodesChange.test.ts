import { describe, expect, it } from "vitest";
import { applyNodeChanges, type NodeChange } from "@xyflow/react";
import type { FlowNode, FlowEdge } from "@/lib/flows/schema";

const ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("onNodesChange remove handling", () => {
  function makeFlowNodes(): FlowNode[] {
    return [
      {
        id: "n1",
        type: "on_receive",
        config: { asset: { kind: "known", symbol: "USDC" } },
      },
      {
        id: "n2",
        type: "pay",
        config: {
          recipient: ADDR,
          amountStroops: "100",
          asset: { kind: "native" },
        },
      },
    ];
  }

  function makeRfEdges(): FlowEdge[] {
    return [{ id: "e1", source: "n1", target: "n2" }];
  }

  it("filters removed nodes from flowNodes", () => {
    const flowNodes = makeFlowNodes();
    const rfNodes = [
      { id: "n1", type: "trigger" as const, position: { x: 0, y: 0 }, data: {} },
      { id: "n2", type: "action" as const, position: { x: 0, y: 0 }, data: {} },
    ];

    const changes: NodeChange[] = [{ type: "remove", id: "n1" }];
    const removedIds = changes
      .filter((c): c is { type: "remove"; id: string } => c.type === "remove")
      .map((c) => c.id);

    expect(removedIds).toEqual(["n1"]);

    const removedSet = new Set(removedIds);
    const nextFlowNodes = flowNodes.filter((n) => !removedSet.has(n.id));

    expect(nextFlowNodes.map((n) => n.id)).toEqual(["n2"]);
  });

  it("filters edges connected to removed nodes", () => {
    const rfEdges = makeRfEdges();
    const removedIds = ["n1"];
    const removedSet = new Set(removedIds);

    const nextRfEdges = rfEdges.filter(
      (e) => !removedSet.has(e.source) && !removedSet.has(e.target),
    );

    expect(nextRfEdges).toEqual([]);
  });

  it("applyNodeChanges correctly removes nodes from rfNodes", () => {
    const rfNodes = [
      { id: "n1", type: "trigger" as const, position: { x: 0, y: 0 }, data: {} },
      { id: "n2", type: "action" as const, position: { x: 100, y: 0 }, data: {} },
    ];

    const changes: NodeChange[] = [{ type: "remove", id: "n1" }];
    const nextRfNodes = applyNodeChanges(changes, rfNodes);

    expect(nextRfNodes.map((n) => n.id)).toEqual(["n2"]);
  });

  it("handles multiple removals", () => {
    const flowNodes = makeFlowNodes();
    const changes: NodeChange[] = [
      { type: "remove", id: "n1" },
      { type: "remove", id: "n2" },
    ];

    const removedIds = changes
      .filter((c): c is { type: "remove"; id: string } => c.type === "remove")
      .map((c) => c.id);
    const removedSet = new Set(removedIds);
    const nextFlowNodes = flowNodes.filter((n) => !removedSet.has(n.id));

    expect(nextFlowNodes).toEqual([]);
  });

  it("does not filter non-remove changes from flowNodes", () => {
    const flowNodes = makeFlowNodes();
    const rfNodes = [
      { id: "n1", type: "trigger" as const, position: { x: 0, y: 0 }, data: {} },
      { id: "n2", type: "action" as const, position: { x: 100, y: 0 }, data: {} },
    ];

    const changes: NodeChange[] = [{ type: "position", id: "n1", position: { x: 50, y: 50 } }];

    const removedIds = changes
      .filter((c): c is { type: "remove"; id: string } => c.type === "remove")
      .map((c) => c.id);

    if (removedIds.length > 0) {
      const removedSet = new Set(removedIds);
      const nextFlowNodes = flowNodes.filter((n) => !removedSet.has(n.id));
      expect(nextFlowNodes.map((n) => n.id)).toEqual(["n1", "n2"]);
    } else {
      expect(flowNodes.map((n) => n.id)).toEqual(["n1", "n2"]);
    }

    const nextRfNodes = applyNodeChanges(changes, rfNodes);
    expect(nextRfNodes.find((n) => n.id === "n1")?.position).toEqual({
      x: 50,
      y: 50,
    });
  });
});
