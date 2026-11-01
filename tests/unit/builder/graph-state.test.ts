import { describe, expect, it } from "vitest";
import {
  builderGraph,
  editBuilderNodes,
  removeBuilderNodes,
} from "@/components/builder/graph-state.utils";
import { FlowGraphSchema, FlowSaveSchema } from "@/lib/flows/schema";
import { applyPatch } from "@/lib/ai/normalize";
import { validateFlow } from "@/lib/flows/validate";

const saved = () =>
  FlowGraphSchema.parse({
    nodes: [
      {
        id: "pay",
        type: "pay",
        config: { recipient: "", fullAmount: true, asset: { kind: "native" } },
      },
    ],
    edges: [],
    fieldPolicies: { version: 1, nodes: [{ kind: "pay", nodeId: "pay", recipient: "execution" }] },
  });

describe("builder policy metadata preservation", () => {
  it("retains policy authority through node editing, layout, autosave and server patch", () => {
    const graph = saved();
    const edited = builderGraph(
      graph.nodes.map((node) =>
        node.type === "pay"
          ? {
              ...node,
              config: { ...node.config, email: "person@example.com" },
            }
          : node,
      ),
      graph.edges,
      {
        fieldPolicies: graph.fieldPolicies,
        notify: { mode: "off", sendTo: "" },
        positions: { pay: { x: 10, y: 20 } },
      },
    );
    const roundTrip = FlowSaveSchema.parse(
      JSON.parse(JSON.stringify({ name: "Edited", graph: edited })),
    );
    expect(roundTrip.graph.fieldPolicies).toEqual(graph.fieldPolicies);
    expect(roundTrip.graph.positions).toEqual({ pay: { x: 10, y: 20 } });
    const patched = applyPatch(roundTrip.graph, [
      { op: "setNotify", notify: { mode: "off", sendTo: "owner@example.com" } },
    ]);
    expect(patched.fieldPolicies).toEqual(graph.fieldPolicies);
    const validation = validateFlow(patched);
    expect(validation.ok).toBe(false);
    if (!validation.ok)
      expect(validation.errors.some((e) => e.code === "FIELD_POLICY_UNSUPPORTED")).toBe(true);
  });
  it("does not copy previous-flow policies into a different graph's serialization", () => {
    const graph = saved();
    const policyGraph = builderGraph(graph.nodes, graph.edges, graph);
    const replacement = builderGraph([], [], { notify: { mode: "off", sendTo: "" } });
    expect(policyGraph.fieldPolicies).toBeDefined();
    expect(replacement).not.toHaveProperty("fieldPolicies");
  });
});

describe("draft structural policy edits", () => {
  const splitDraft = () =>
    FlowGraphSchema.parse({
      nodes: [
        ...saved().nodes,
        {
          id: "split",
          type: "split",
          config: {
            asset: { kind: "native" },
            recipients: [
              { rowId: "platform", address: "", mode: "percentage", bps: 1000 },
              { rowId: "worker", address: "", mode: "percentage", bps: 9000 },
            ],
          },
        },
      ],
      edges: [],
      fieldPolicies: {
        version: 1,
        nodes: [
          ...saved().fieldPolicies!.nodes,
          {
            kind: "split",
            nodeId: "split",
            allocationMode: "percentage",
            rows: [
              { rowId: "platform" },
              { rowId: "worker", recipient: "execution", allocation: "execution" },
            ],
            additionalRecipients: "execution",
          },
        ],
      },
    });
  const save = (draft: ReturnType<typeof editBuilderNodes>) =>
    FlowSaveSchema.parse({ name: "Draft", graph: { ...draft, edges: [] } }).graph;
  it("keeps both keyboard and panel node removal saveable without dropping surviving policies", () => {
    const draft = splitDraft();
    const keyboard = removeBuilderNodes(draft, new Set(["pay"]));
    expect(save(keyboard).fieldPolicies?.nodes).toEqual(
      draft.fieldPolicies?.nodes.filter((p) => p.nodeId !== "pay"),
    );
    const panel = removeBuilderNodes(draft, new Set(["split"]));
    expect(save(panel).fieldPolicies?.nodes).toEqual(
      draft.fieldPolicies?.nodes.filter((p) => p.nodeId !== "split"),
    );
    const empty = removeBuilderNodes(keyboard, new Set(["split"]));
    expect(save(empty).fieldPolicies).toEqual({ version: 1, nodes: [] });
    // Reusing a deleted draft node ID must not resurrect its former execution authority.
    const replacement = editBuilderNodes(empty, saved().nodes);
    expect(save(replacement).fieldPolicies?.nodes).toEqual([]);
    expect(draft.fieldPolicies?.nodes).toHaveLength(2);
  });
  it("drops only removed rows, assigns fresh constant IDs and retains surviving field modes", () => {
    const draft = splitDraft();
    const next = editBuilderNodes(
      draft,
      draft.nodes.map((node) =>
        node.type === "split"
          ? {
              ...node,
              config: {
                ...node.config,
                recipients: [
                  node.config.recipients[1]!,
                  { address: "", mode: "percentage", bps: 1000 },
                ],
              },
            }
          : node,
      ),
    );
    const graph = save(next);
    const policy = graph.fieldPolicies?.nodes.find((p) => p.kind === "split");
    expect(policy?.kind).toBe("split");
    if (policy?.kind !== "split") throw new Error("Missing policy");
    expect(policy.rows[0]).toEqual({
      rowId: "worker",
      recipient: "execution",
      allocation: "execution",
    });
    expect(policy.rows[1]).toEqual({
      rowId: expect.any(String),
      recipient: "constant",
      allocation: "constant",
    });
    expect(policy.rows[1]?.rowId).not.toBe("platform");
    expect(policy.additionalRecipients).toBe("execution");
    const repeat = editBuilderNodes(next, next.nodes);
    expect(repeat).toEqual(next);
  });
  it("retires only the irrelevant stored-value policy when a draft Pay changes to full amount", () => {
    const draft = FlowGraphSchema.parse({
      ...saved(),
      nodes: saved().nodes.map((node) =>
        node.type === "pay"
          ? {
              ...node,
              config: { ...node.config, fullAmount: false, mode: "fixed", amountStroops: "100" },
            }
          : node,
      ),
      fieldPolicies: {
        version: 1,
        nodes: [{ kind: "pay", nodeId: "pay", recipient: "execution", payoutValue: "mutable" }],
      },
    });
    const next = editBuilderNodes(draft, saved().nodes);
    expect(save(next).fieldPolicies?.nodes[0]).toMatchObject({
      recipient: "execution",
      payoutValue: "constant",
    });
  });
  it("keeps row identity/modes while changing a draft Split's allocation mode", () => {
    const draft = splitDraft();
    const next = editBuilderNodes(
      draft,
      draft.nodes.map((node) =>
        node.type === "split"
          ? {
              ...node,
              config: {
                ...node.config,
                recipients: node.config.recipients.map((row) => ({
                  rowId: row.rowId,
                  address: row.address,
                  mode: "fixed",
                  amountStroops: "0",
                })),
              },
            }
          : node,
      ),
    );
    const graph = save(next);
    const policy = graph.fieldPolicies?.nodes.find((p) => p.kind === "split");
    expect(policy).toMatchObject({
      allocationMode: "fixed",
      rows: [
        { rowId: "platform", recipient: "constant", allocation: "constant" },
        { rowId: "worker", recipient: "execution", allocation: "execution" },
      ],
    });
  });
});
