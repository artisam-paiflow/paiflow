import { describe, expect, it } from "vitest";
import { toCanvasGraph } from "@/lib/flows/canvas-graph";
import { FlowGraphSchema, type FlowGraph } from "@/lib/flows/schema";

describe("deployment canvas labels", () => {
  it("renders strict Hold and Return outcomes as actions with their branch labels", () => {
    const graph = FlowGraphSchema.parse({
      nodes: [
        { id: "receive", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "deadline",
          type: "condition",
          config: { kind: "time_after", at: "2026-10-12T00:00:00Z" },
        },
        { id: "hold", type: "hold", config: {} },
        { id: "return", type: "return_to_owner", config: {} },
      ],
      edges: [
        { id: "in", source: "receive", target: "deadline" },
        { id: "before", source: "deadline", target: "hold", sourceHandle: "false" },
        { id: "after", source: "deadline", target: "return", sourceHandle: "true" },
      ],
    });
    const canvas = toCanvasGraph(graph);
    expect(canvas.nodes).toEqual([
      { id: "receive", label: "On Receive (XLM)", role: "trigger" },
      { id: "deadline", label: "Condition (time_after)", role: "logic" },
      { id: "hold", label: "Hold", role: "action" },
      { id: "return", label: "Return to owner", role: "action" },
    ]);
    expect(canvas.edges).toEqual([
      { id: "in", source: "receive", target: "deadline" },
      { id: "before", source: "deadline", target: "hold", label: "False" },
      { id: "after", source: "deadline", target: "return", label: "True" },
    ]);
    expect(canvas.nodes.every((node) => !("config" in node))).toBe(true);
  });

  it("preserves the fallback for unsupported runtime node types", () => {
    const graph = {
      nodes: [{ id: "future", type: "unsupported", config: {} }],
      edges: [],
    } as unknown as FlowGraph;
    expect(toCanvasGraph(graph).nodes).toEqual([{ id: "future", label: "Unknown", role: "other" }]);
  });
});
