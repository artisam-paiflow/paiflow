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
