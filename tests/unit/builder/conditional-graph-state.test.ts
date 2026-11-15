import { describe, expect, it } from "vitest";
import { ConditionalCanvasSchema } from "@/lib/flows/conditional-canvas-schema";
import { OrdinaryFlowSaveSchema } from "@/lib/flows/ordinary-schema";
import { FlowGraphSchema } from "@/lib/flows/schema";
import {
  builderDraft,
  builderGraph,
  editBuilderNodes,
  removeBuilderNodes,
  enableConditionalDraft,
  updateConditionalThresholdMode,
} from "@/components/builder/graph-state.utils";
import { updateBuilderPolicy } from "@/components/builder/field-policy.utils";
import { createBuilderEditGate } from "@/components/builder/edit-response-gate.utils";
const wallet = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const source = () =>
  FlowGraphSchema.parse({
    nodes: [
      { id: "root", type: "on_receive", config: { asset: { kind: "native" } } },
      { id: "condition", type: "condition", config: { kind: "amount_gt", amountStroops: "0" } },
      {
        id: "yes",
        type: "split",
        config: {
          asset: { kind: "native" },
          recipients: [{ rowId: "stable", address: wallet, mode: "percentage", bps: 10000 }],
        },
      },
      { id: "no", type: "return_to_owner", config: {} },
    ],
    edges: [
      { id: "a", source: "root", target: "condition" },
      { id: "b", source: "condition", target: "yes", sourceHandle: "true" },
      { id: "c", source: "condition", target: "no", sourceHandle: "false" },
    ],
  });
const conditional = () => enableConditionalDraft(builderDraft(source()));
describe("conditional ordinary builder metadata", () => {
  it("requires an explicit opt-in rather than interpreting old amount conditions", () => {
    const old = source(),
      legacy = builderDraft(old);
    expect(legacy).not.toHaveProperty("generation");
    expect(legacy).not.toHaveProperty("conditionalPolicies");
    const next = enableConditionalDraft(legacy);
    expect(next.generation).toBe("conditional-v2");
    expect(next.conditionalPolicies.condition).toBeUndefined();
    expect(old).not.toHaveProperty("generation");
  });
  it("refuses unsupported existing blocks before opt-in without changing the original", () => {
    const old = source();
    old.nodes.push({
      id: "schedule",
      type: "on_schedule",
      config: { intervalAmount: 1, intervalUnit: "hour", startsAt: "2099-01-01T00:00:00.000Z" },
    });
    expect(() => enableConditionalDraft(builderDraft(old))).toThrow(/Remove other blocks/);
    expect(old).not.toHaveProperty("generation");
  });
  it("preserves generation, declarations, handles and layout through JSON autosave and reopen", () => {
    let d = conditional();
    d = updateConditionalThresholdMode(d, "condition", "mutable") as typeof d;
    const graph = builderGraph(d.nodes, source().edges, {
      ...d,
      positions: { yes: { x: 10, y: 20 } },
      notify: { mode: "off", sendTo: "" },
    });
    const stored = OrdinaryFlowSaveSchema.parse(
      JSON.parse(JSON.stringify({ name: "Conditional", graph })),
    ).graph;
    expect(stored).toMatchObject({
      generation: "conditional-v2",
      conditionalPolicies: {
        version: 2,
        condition: { nodeId: "condition", thresholdMode: "mutable" },
      },
      positions: { yes: { x: 10, y: 20 } },
    });
    expect(stored.edges).toEqual(source().edges);
    expect(builderDraft(stored)).toEqual(d);
    expect(() => FlowGraphSchema.parse(stored)).toThrow();
  });
  it("applies Pay/Split declaration edits atomically to the new envelope only", () => {
    const d = conditional(),
      p = d.conditionalPolicies.nodes.find((p) => p.nodeId === "yes");
    if (p?.kind !== "split") throw new Error();
    const next = updateBuilderPolicy(d, {
      ...p,
      rows: p.rows.map((r) => ({ ...r, recipient: "execution", allocation: "execution" })),
    });
    expect(next).not.toHaveProperty("fieldPolicies");
    expect("generation" in next && next.conditionalPolicies.nodes[0]).toMatchObject({
      nodeId: "yes",
      rows: [{ rowId: "stable", recipient: "execution", allocation: "execution" }],
    });
    expect(next.nodes[2]?.type).toBe("split");
  });
  it("retains surviving row modes and gives only new rows fresh identities and constant authority", () => {
    let d = conditional();
    const p = d.conditionalPolicies.nodes[0];
    if (p?.kind !== "split") throw new Error();
    d = updateBuilderPolicy(d, {
      ...p,
      rows: [{ ...p.rows[0]!, recipient: "mutable", allocation: "mutable" }],
    }) as typeof d;
    const nodes = structuredClone(d.nodes),
      split = nodes.find((n) => n.type === "split");
    if (split?.type !== "split") throw new Error();
    split.config.recipients.push({ address: "", mode: "percentage", bps: 0 });
    const next = editBuilderNodes(d, nodes);
    if (!("generation" in next)) throw new Error();
    const policy = next.conditionalPolicies.nodes[0];
    if (policy?.kind !== "split") throw new Error();
    expect(policy.rows[0]).toEqual({
      rowId: "stable",
      recipient: "mutable",
      allocation: "mutable",
    });
    expect(policy.rows[1]).toMatchObject({ recipient: "constant", allocation: "constant" });
    expect(policy.rows[1]!.rowId).not.toBe("stable");
    const edited = next.nodes.find((n) => n.type === "split");
    if (edited?.type !== "split") throw new Error();
    expect(edited.config.recipients[1]!.rowId).toBe(policy.rows[1]!.rowId);
  });
  it("deleting a condition drops only its old mode and a replacement starts constant", () => {
    const d = updateConditionalThresholdMode(conditional(), "condition", "mutable");
    const removed = removeBuilderNodes(d, new Set(["condition"]));
    expect("generation" in removed && removed.conditionalPolicies.condition).toBeUndefined();
    const replaced = editBuilderNodes(removed, [
      ...removed.nodes,
      {
        id: "new-condition",
        type: "condition",
        config: { kind: "amount_lt", amountStroops: "50" },
      },
    ]);
    if (!("generation" in replaced) || !("generation" in d)) throw new Error();
    expect(replaced.conditionalPolicies.condition).toBeUndefined();
    expect(replaced.conditionalPolicies.nodes).toEqual(d.conditionalPolicies.nodes);
  });
  it("cannot turn a legacy draft into v2 by changing only a threshold declaration", () => {
    const old = builderDraft(source());
    expect(updateConditionalThresholdMode(old, "condition", "mutable")).toBe(old);
  });
  it("retains semantic owner return through removals and snapshot restoration", () => {
    const original = conditional(),
      removed = removeBuilderNodes(original, new Set(["yes"]));
    expect(removed.nodes.find((n) => n.id === "no")?.type).toBe("return_to_owner");
    const restored = builderDraft(
      ConditionalCanvasSchema.parse(builderGraph(original.nodes, source().edges, { ...original })),
    );
    expect(restored).toEqual(original);
  });
  it("preserves a mutable additional roster and its row IDs through unrelated edits", () => {
    const d = conditional(),
      p = d.conditionalPolicies.nodes[0];
    if (p?.kind !== "split") throw new Error();
    const declared = updateBuilderPolicy(d, { ...p, additionalRecipients: "mutable" });
    const split = declared.nodes.find((n) => n.type === "split");
    if (split?.type !== "split") throw new Error();
    split.config.additionalRecipients = [
      { rowId: "extra", recipient: wallet, allocation: { kind: "percentage", bps: 1 } },
    ];
    const edited = editBuilderNodes(
      declared,
      declared.nodes.map((n) =>
        n.type === "condition" ? { ...n, config: { kind: "amount_lt", amountStroops: "1" } } : n,
      ),
    );
    expect(edited.nodes.find((n) => n.type === "split")).toEqual(split);
    expect("generation" in edited && edited.conditionalPolicies.nodes[0]).toMatchObject({
      additionalRecipients: "mutable",
    });
  });
});
describe("async draft response fence", () => {
  it("keeps an original edit pending and refuses parallel requests", () => {
    const gate = createBuilderEditGate(),
      attempt = gate.begin();
    expect(attempt?.isCurrent()).toBe(true);
    expect(gate.pending).toBe(true);
    expect(gate.begin()).toBeNull();
    attempt?.finish();
    expect(gate.pending).toBe(false);
  });
  it("ignores a delayed pre-generation response and retains the newer conditional draft", async () => {
    const gate = createBuilderEditGate();
    let release: (value: typeof source extends () => infer T ? T : never) => void = () => {};
    const delayed = new Promise<ReturnType<typeof source>>((resolve) => {
      release = resolve;
    });
    const attempt = gate.begin()!;
    let state = builderDraft(source());
    const delivery = (async () => {
      const old = await delayed;
      if (attempt.isCurrent()) state = builderDraft(old);
      attempt.finish();
    })();
    state = conditional();
    gate.invalidate();
    release(source());
    await delivery;
    expect(state).toHaveProperty("generation", "conditional-v2");
    expect(gate.pending).toBe(false);
  });
  it("an old finish cannot unlock a newer operation", () => {
    const gate = createBuilderEditGate(),
      first = gate.begin()!;
    first.finish();
    const second = gate.begin()!;
    first.finish();
    expect(gate.pending).toBe(true);
    expect(second.isCurrent()).toBe(true);
    second.finish();
  });
});
