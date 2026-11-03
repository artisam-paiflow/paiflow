import { describe, expect, it } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import { FlowGraphSchema, FlowPatchSchema, type FlowGraph } from "@/lib/flows/schema";
import { validateFlow } from "@/lib/flows/validate";
import {
  EXECUTION_V1_WASM_HASHES,
  MUTATION_V1_WASM_HASHES,
} from "@/lib/stellar/execution-artifacts";
import {
  builderNodePolicy,
  executionArtifactsFromHashes,
  executionDeploymentAvailable,
  executionEditingIssue,
  updateBuilderPolicy,
} from "@/components/builder/field-policy.utils";
import { editBuilderNodes, removeBuilderNodes } from "@/components/builder/graph-state.utils";

const ADDRESS = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
function splitGraph(): FlowGraph {
  return FlowGraphSchema.parse({
    nodes: [
      { id: "receive", type: "on_receive", config: { asset: { kind: "native" } } },
      {
        id: "split",
        type: "split",
        config: {
          asset: { kind: "native" },
          recipients: [
            { address: ADDRESS, label: "Platform", mode: "percentage", bps: 1000 },
            { address: "", label: "Worker", mode: "percentage", bps: 0 },
          ],
        },
      },
    ],
    edges: [{ id: "edge", source: "receive", target: "split" }],
  });
}
function declare(graph = splitGraph()) {
  const policy = builderNodePolicy(graph.nodes[1]!, graph.fieldPolicies);
  if (policy?.kind !== "split") throw new Error("Expected split");
  return updateBuilderPolicy(graph, {
    ...policy,
    rows: policy.rows.map((row, i) =>
      i === 1 ? { ...row, recipient: "execution", allocation: "execution" } : row,
    ),
  });
}
describe("builder field declarations", () => {
  it("keeps legacy definitions mode-less until an explicit declaration and preserves constant values", () => {
    const graph = splitGraph();
    expect(graph.fieldPolicies).toBeUndefined();
    const draft = declare(graph);
    const saved = FlowPatchSchema.parse({ graph: { ...graph, ...draft } }).graph!;
    expect(saved.nodes[1]?.config).toMatchObject({
      recipients: [
        { address: ADDRESS, bps: 1000, rowId: "row-1" },
        { address: "", bps: 0, rowId: "row-2" },
      ],
    });
    expect(saved.fieldPolicies?.nodes[0]).toMatchObject({
      rows: [
        { rowId: "row-1", recipient: "constant", allocation: "constant" },
        { rowId: "row-2", recipient: "execution", allocation: "execution" },
      ],
    });
    expect(validateFlow(saved).ok).toBe(true);
    expect(validateFlow(graph).ok).toBe(false);
  });

  it("allocates stable IDs without colliding with an existing identified row", () => {
    const graph = splitGraph();
    const split = graph.nodes[1]!;
    if (split.type !== "split") throw new Error("Expected split");
    split.config.recipients[1]!.rowId = "row-1";
    const policy = builderNodePolicy(split);
    expect(policy?.kind === "split" && policy.rows.map((row) => row.rowId)).toEqual([
      "row-2",
      "row-1",
    ]);
  });

  it("preserves surviving modes through delete/add and does not give a new row deleted permissions", () => {
    const draft = declare();
    const split = draft.nodes[1]!;
    if (split.type !== "split") throw new Error("Expected split");
    const edited = editBuilderNodes(draft, [
      draft.nodes[0]!,
      {
        ...split,
        config: {
          ...split.config,
          recipients: [split.config.recipients[0]!, { address: "", mode: "percentage", bps: 0 }],
        },
      },
    ]);
    const saved = FlowPatchSchema.parse({ graph: { ...splitGraph(), ...edited } }).graph!;
    const policy = saved.fieldPolicies?.nodes[0];
    expect(policy?.kind === "split" && policy.rows[0]).toMatchObject({
      rowId: "row-1",
      recipient: "constant",
      allocation: "constant",
    });
    expect(policy?.kind === "split" && policy.rows[1]).toMatchObject({
      recipient: "constant",
      allocation: "constant",
    });
    expect(policy?.kind === "split" && policy.rows[1]?.rowId).not.toBe("row-2");
    expect(removeBuilderNodes(edited, new Set(["split"])).fieldPolicies?.nodes).toEqual([]);
  });

  it("does not require a Pay runtime recipient but still requires its configured payout", () => {
    const graph = FlowGraphSchema.parse({
      nodes: [
        splitGraph().nodes[0],
        {
          id: "pay",
          type: "pay",
          config: {
            asset: { kind: "native" },
            recipient: "",
            mode: "fixed",
            amountStroops: "10000000",
          },
        },
      ],
      edges: [{ id: "edge", source: "receive", target: "pay" }],
    });
    const policy = builderNodePolicy(graph.nodes[1]!);
    if (policy?.kind !== "pay") throw new Error("Expected Pay");
    const saved = {
      ...graph,
      ...updateBuilderPolicy(graph, { ...policy, recipient: "execution" }),
    };
    expect(validateFlow(saved).ok).toBe(true);
    const pay = saved.nodes[1]!;
    if (pay.type !== "pay") throw new Error("Expected Pay");
    expect(
      validateFlow({
        ...saved,
        nodes: [saved.nodes[0], { ...pay, config: { ...pay.config, amountStroops: "0" } }],
      }).ok,
    ).toBe(false);
  });

  it("does not offer the immediate execution path for scheduled or branched flows", () => {
    expect(executionEditingIssue(splitGraph())).toBeUndefined();
    const graph = splitGraph();
    expect(
      executionEditingIssue({
        ...graph,
        nodes: [
          {
            id: "receive",
            type: "on_schedule",
            config: { intervalAmount: 1, intervalUnit: "day", startsAt: "2030-01-01T00:00:00Z" },
          },
          graph.nodes[1]!,
        ],
      }),
    ).toContain("On Receive");
    expect(executionEditingIssue({ ...graph, edges: [...graph.edges, graph.edges[0]!] })).toContain(
      "one On Receive path",
    );
  });
});

describe("environment artifact readiness", () => {
  it("validates initial mutable appended allocation totals, uniqueness and the combined20row limit", () => {
    const g = splitGraph(),
      node = g.nodes[1];
    if (node?.type !== "split") throw new Error();
    node.config.recipients = [
      { rowId: "platform", address: ADDRESS, mode: "percentage", bps: 500 },
    ];
    node.config.additionalRecipients = Array.from({ length: 19 }, (_, i) => ({
      rowId: `extra_${i}`,
      recipient: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, i + 10)),
      allocation: { kind: "percentage" as const, bps: 500 },
    }));
    g.fieldPolicies = {
      version: 1,
      nodes: [
        {
          kind: "split",
          nodeId: node.id,
          allocationMode: "percentage",
          rows: [{ rowId: "platform", recipient: "constant", allocation: "constant" }],
          additionalRecipients: "mutable",
        },
      ],
    };
    expect(validateFlow(g).ok).toBe(true);
    node.config.additionalRecipients[0]!.allocation = { kind: "percentage", bps: 400 };
    expect(validateFlow(g).ok).toBe(false);
    node.config.additionalRecipients[0]!.allocation = { kind: "percentage", bps: 500 };
    node.config.additionalRecipients[0]!.recipient = ADDRESS;
    expect(validateFlow(g).ok).toBe(false);
    node.config.additionalRecipients[0]!.recipient = StrKey.encodeEd25519PublicKey(
      Buffer.alloc(32, 10),
    );
    node.config.additionalRecipients.push({
      rowId: "extra_20",
      recipient: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 40)),
      allocation: { kind: "percentage", bps: 500 },
    });
    expect(validateFlow(g).ok).toBe(false);
  });
  it("requires the guarded generation throughout mutable paths and keeps full payout constant", () => {
    const graph = splitGraph(),
      policy = builderNodePolicy(graph.nodes[1]!);
    if (policy?.kind !== "split") throw new Error();
    const mutable = {
      ...graph,
      ...updateBuilderPolicy(graph, { ...policy, additionalRecipients: "mutable" }),
    };
    const old = executionArtifactsFromHashes(new Map(Object.entries(EXECUTION_V1_WASM_HASHES)));
    const guarded = executionArtifactsFromHashes(new Map(Object.entries(MUTATION_V1_WASM_HASHES)));
    expect(executionDeploymentAvailable(mutable, old)).toBe(false);
    expect(executionDeploymentAvailable(mutable, guarded)).toBe(true);
    const mixed = new Map<string, string>(Object.entries(MUTATION_V1_WASM_HASHES));
    mixed.set("DEPOSIT_TRIGGER", EXECUTION_V1_WASM_HASHES.DEPOSIT_TRIGGER);
    expect(executionDeploymentAvailable(mutable, executionArtifactsFromHashes(mixed))).toBe(false);
    const payGraph = FlowGraphSchema.parse({
      nodes: [
        graph.nodes[0],
        {
          id: "pay",
          type: "pay",
          config: { asset: { kind: "native" }, recipient: ADDRESS, fullAmount: true },
        },
      ],
      edges: [{ id: "p", source: "receive", target: "pay" }],
    });
    const full = updateBuilderPolicy(payGraph, {
      kind: "pay",
      nodeId: "pay",
      recipient: "mutable",
      payoutValue: "mutable",
    });
    expect(full.fieldPolicies?.nodes[0]).toMatchObject({
      payoutValue: "constant",
      recipient: "mutable",
    });
  });
  it("matches exact reviewed hashes per kind and fails closed for absent, wrong-kind and unknown artifacts", () => {
    const reviewed = executionArtifactsFromHashes(
      new Map(Object.entries(EXECUTION_V1_WASM_HASHES)),
    );
    expect(reviewed).toEqual({ receive: true, pay: true, split: true });
    const graph = { ...splitGraph(), ...declare() };
    expect(executionDeploymentAvailable(graph, reviewed)).toBe(true);
    expect(executionDeploymentAvailable(graph)).toBe(false);
    expect(executionDeploymentAvailable(graph, { ...reviewed, split: false })).toBe(false);
    expect(executionDeploymentAvailable(graph, { ...reviewed, pay: false })).toBe(true);
    expect(
      executionArtifactsFromHashes(
        new Map([
          ["DEPOSIT_TRIGGER", EXECUTION_V1_WASM_HASHES.PAYER],
          ["PAYER", "a".repeat(64)],
        ]),
      ),
    ).toEqual({ receive: false, pay: false, split: false });
    expect(executionDeploymentAvailable(splitGraph())).toBe(true);
  });
});
