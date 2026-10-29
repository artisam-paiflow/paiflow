import { describe, expect, it } from "vitest";
import { deployPreviewFromGraph } from "@/lib/flows/deploy-preview";
import { FlowGraphSchema, type FlowGraph } from "@/lib/flows/schema";
import { flowToPipeline, getStreamerPreviewFromPipeline } from "@/lib/flows/to-params";
import { validateFlow } from "@/lib/flows/validate";
const OWNER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
function locked(): FlowGraph {
  return FlowGraphSchema.parse({
    nodes: [
      { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
      {
        id: "c",
        type: "condition",
        config: { kind: "time_before", at: "2030-06-01T00:00:00.000Z" },
      },
      { id: "h", type: "hold", config: {} },
      { id: "r", type: "return_to_owner", config: {} },
    ],
    edges: [
      { id: "tc", source: "t", target: "c" },
      { id: "ch", source: "c", target: "h", sourceHandle: "true" },
      { id: "cr", source: "c", target: "r", sourceHandle: "false" },
    ],
  });
}
describe("deployPreviewFromGraph", () => {
  it("previews a valid Hold / Return to owner flow before a wallet is connected", () => {
    const graph = locked();
    expect(validateFlow(graph, { ignoreOwnerEmail: true }).ok).toBe(true);
    expect(() => deployPreviewFromGraph(graph)).not.toThrow();
    expect(deployPreviewFromGraph(graph)).toBeNull();
  });
  it("returns a payroll preview when the graph includes Return to owner", () => {
    const graph = locked();

    graph.nodes[0] = {
      id: "t",
      type: "payroll",
      config: {
        asset: { kind: "native" },
        employer: OWNER,
        intervalAmount: 1,
        intervalUnit: "month",
        occurrences: 2,
      },
    };
    graph.nodes.push({
      id: "s",
      type: "split",
      config: {
        asset: { kind: "native" },
        recipients: [{ address: OWNER, mode: "fixed", amountStroops: "10000000" }],
      },
    });
    graph.edges[0] = { id: "ts", source: "t", target: "s" };
    graph.edges.push({ id: "sc", source: "s", target: "c" });
    expect(deployPreviewFromGraph(graph)).toMatchObject({
      amountPerPeriodStroops: "10000000",
      recipients: [{ address: OWNER, amount: "10000000" }],
      intervalSeconds: 2592000,
      durationSecs: 5184000,
      totalStroops: "20000000",
    });
  });
  it("preserves the existing streamer preview", () => {
    const graph = FlowGraphSchema.parse({
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: {
            intervalAmount: 1,
            intervalUnit: "hour",
            startsAt: "2030-01-01T00:00:00.000Z",
            occurrences: 3,
          },
        },
        {
          id: "p",
          type: "pay",
          config: {
            recipient: OWNER,
            amountStroops: "3600000",
            asset: { kind: "native" },
            mode: "fixed",
          },
        },
      ],
      edges: [{ id: "tp", source: "t", target: "p" }],
    });
    const previous = getStreamerPreviewFromPipeline(flowToPipeline(graph));
    expect(previous).toMatchObject({
      amountPerIntervalStroops: "3600000",
      intervalSeconds: 3600,
      durationSecs: 10800,
      totalStroops: "10800000",
    });
    expect(deployPreviewFromGraph(graph)).toEqual(previous);
  });
});
