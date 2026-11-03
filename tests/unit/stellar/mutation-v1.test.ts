import { describe, expect, it } from "vitest";
import { scValToNative, StrKey } from "@stellar/stellar-sdk";
import { FlowGraphSchema, FlowSaveSchema } from "@/lib/flows/schema";
import { flowToPipeline } from "@/lib/flows/to-params";
import { validateFlow } from "@/lib/flows/validate";
import {
  executionArtifactsFromHashes,
  executionDeploymentAvailable,
} from "@/components/builder/field-policy.utils";
import { MutationArgumentsSchema } from "@/lib/flows/field-policies";
import {
  executionConstructorConfig,
  decodeExecutionCapabilities,
  decodeExecutionState,
  mutationV1Args,
} from "@/lib/stellar/execution-v1";
import {
  assertExecutionArtifact,
  assertMutationArtifact,
  executionArtifactMetadata,
  EXECUTION_V1_WASM_HASHES,
  MUTATION_V1_WASM_HASHES,
} from "@/lib/stellar/execution-artifacts";
const wallet = (byte: number) => StrKey.encodeEd25519PublicKey(Buffer.alloc(32, byte));
const contract = (byte: number) => StrKey.encodeContract(Buffer.alloc(32, byte));
const a = wallet(1),
  b = wallet(2),
  c = wallet(3),
  asset = { kind: "native" } as const;
function graph() {
  return FlowGraphSchema.parse({
    nodes: [
      { id: "root", type: "on_receive", config: { asset } },
      {
        id: "split",
        type: "split",
        config: {
          asset,
          recipients: [{ rowId: "platform", address: a, mode: "percentage", bps: 1500 }],
          additionalRecipients: [
            { rowId: "worker", recipient: b, allocation: { kind: "percentage", bps: 8500 } },
          ],
        },
      },
    ],
    edges: [{ id: "e", source: "root", target: "split" }],
    fieldPolicies: {
      version: 1,
      nodes: [
        {
          kind: "split",
          nodeId: "split",
          allocationMode: "percentage",
          rows: [{ rowId: "platform" }],
          additionalRecipients: "mutable",
        },
      ],
    },
  });
}
describe("guarded stored mutation v1", () => {
  it("preserves valid initial mutable appended roster through save, compile and constructor ABI", () => {
    const value = graph();
    const saved = FlowSaveSchema.parse({ name: "Mutable roster", graph: value }).graph;
    expect(saved).toEqual(value);
    expect(validateFlow(saved).ok).toBe(true);
    const node = flowToPipeline(saved)[1]!;
    if (node.params.kind !== "splitter") throw new Error();
    expect(node.params.initialAdditionalRecipients).toEqual([
      { rowId: "worker", recipient: b, allocation: { kind: "percentage", bps: 8500 } },
    ]);
    const config = scValToNative(
      executionConstructorConfig(node.params, { root: contract(1), split: contract(2) }),
    );
    expect(config.policy.additional_mode).toEqual(["Mutable"]);
    expect(config.policy.rows[0].recipient).toBe(a);
    expect(config.additional).toEqual([
      { row_id: "worker", recipient: b, allocation: ["Percentage", 8500] },
    ]);
  });
  it.each(["missing", "wrong total", "collision", "mode", "undeclared", "legacy"])(
    "rejects invalid initial stored roster: %s",
    (attack) => {
      const value = graph();
      const split = value.nodes[1];
      if (split?.type !== "split") throw new Error();
      if (attack === "missing") delete split.config.additionalRecipients;
      if (attack === "wrong total")
        split.config.additionalRecipients![0]!.allocation = { kind: "percentage", bps: 8000 };
      if (attack === "collision") split.config.additionalRecipients![0]!.rowId = "platform";
      if (attack === "mode")
        split.config.additionalRecipients![0]!.allocation = { kind: "fixed", amountStroops: "10" };
      if (attack === "undeclared") {
        const policy = value.fieldPolicies!.nodes[0]!;
        if (policy.kind !== "split") throw new Error();
        policy.additionalRecipients = "execution";
      }
      if (attack === "legacy") delete value.fieldPolicies;
      expect(validateFlow(value).ok).toBe(false);
      expect(() => flowToPipeline(FlowGraphSchema.parse(value))).toThrow();
    },
  );
  it("requires complete initial stored percentage allocation even when no configured rows exist", () => {
    const value = graph();
    const split = value.nodes[1];
    const policy = value.fieldPolicies!.nodes[0];
    if (split?.type !== "split" || policy?.kind !== "split") throw new Error();
    split.config.recipients = [];
    policy.rows = [];
    split.config.additionalRecipients![0]!.allocation = { kind: "percentage", bps: 10000 };
    expect(validateFlow(value).ok).toBe(true);
  });
  it("does not parse stored constructor recipients as execution defaults or accept hidden keys", () => {
    const value = graph();
    const split = value.nodes[1];
    if (split?.type !== "split") throw new Error();
    Object.assign(split.config.additionalRecipients![0]!, { token: "secret" });
    expect(FlowGraphSchema.safeParse(value).success).toBe(false);
  });
  it("does not offer mutable deployment with execution-only configured artifacts", () => {
    expect(
      executionDeploymentAvailable(
        graph(),
        executionArtifactsFromHashes(new Map(Object.entries(EXECUTION_V1_WASM_HASHES))),
      ),
    ).toBe(false);
    expect(
      executionDeploymentAvailable(
        graph(),
        executionArtifactsFromHashes(new Map(Object.entries(MUTATION_V1_WASM_HASHES))),
      ),
    ).toBe(true);
  });
  it("retains exact execution-only artifacts and requires new per-kind hashes for mutation", () => {
    expect(EXECUTION_V1_WASM_HASHES.PAYER).toBe(
      "be042aff166c3295cba284600e8455409323491a4e0256524a575d342c5e103b",
    );
    for (const kind of ["DEPOSIT_TRIGGER", "PAYER", "SPLITTER"] as const) {
      expect(() => assertExecutionArtifact(kind, EXECUTION_V1_WASM_HASHES[kind])).not.toThrow();
      expect(executionArtifactMetadata(kind, EXECUTION_V1_WASM_HASHES[kind])).toMatchObject({
        mutation: false,
      });
      expect(() => assertMutationArtifact(kind, EXECUTION_V1_WASM_HASHES[kind])).toThrow();
      expect(() => assertExecutionArtifact(kind, MUTATION_V1_WASM_HASHES[kind])).not.toThrow();
      expect(executionArtifactMetadata(kind, MUTATION_V1_WASM_HASHES[kind])).toMatchObject({
        mutation: true,
      });
    }
    expect(() => assertMutationArtifact("PAYER", MUTATION_V1_WASM_HASHES.SPLITTER)).toThrow();
  });
  it("binds mutation capability to a reviewed hash and refuses false getter labels", () => {
    const raw = {
      policy_version: 1,
      execution_abi: 1,
      execution: true,
      mutation: true,
      immutable_policies: true,
      revision_binding: true,
    };
    expect(decodeExecutionCapabilities(raw, MUTATION_V1_WASM_HASHES.PAYER)).toMatchObject({
      mutation: true,
    });
    expect(() => decodeExecutionCapabilities(raw, EXECUTION_V1_WASM_HASHES.PAYER)).toThrow();
    expect(() =>
      decodeExecutionCapabilities({ ...raw, mutation: false }, MUTATION_V1_WASM_HASHES.PAYER),
    ).toThrow();
  });
  it("encodes exact grouped partial changes with full ordered revisions and optional roster presence", () => {
    const nodes = [
      { nodeId: "root", contractAddress: contract(1), expectedRevision: "0" },
      { nodeId: "pay", contractAddress: contract(2), expectedRevision: "9007199254740993" },
      { nodeId: "split", contractAddress: contract(3), expectedRevision: "2" },
    ];
    const changes = MutationArgumentsSchema.parse({
      version: 1,
      changes: [
        {
          kind: "pay",
          nodeId: "pay",
          expectedRevision: "9007199254740993",
          recipient: c,
          payoutValue: { kind: "fixed", amountStroops: "9007199254740994" },
        },
        {
          kind: "split",
          nodeId: "split",
          expectedRevision: "2",
          rows: [],
          additionalRecipients: [
            { rowId: "new", recipient: c, allocation: { kind: "percentage", bps: 8500 } },
          ],
        },
      ],
    });
    const args = mutationV1Args(nodes, changes).map(scValToNative);
    expect(args[0][1].expected_revision).toBe(9007199254740993n);
    expect(args[1][0]).toEqual([
      "Pay",
      {
        node_id: "pay",
        expected_revision: 9007199254740993n,
        recipient: c,
        payout_value: ["Present", ["Fixed", 9007199254740994n]],
      },
    ]);
    expect(args[1][1][1].additional[0].row_id).toBe("new");
  });
  it.each([
    { version: 1, changes: [] },
    {
      version: 1,
      changes: [
        { kind: "pay", nodeId: "pay", expectedRevision: "0", recipient: c, mode: "mutable" },
      ],
    },
    { version: 1, changes: [{ kind: "split", nodeId: "split", expectedRevision: "0", rows: [] }] },
  ])("rejects empty or authority-changing mutation bodies", (body) => {
    expect(MutationArgumentsSchema.safeParse(body).success).toBe(false);
  });
  it("decodes mutable current stored roster separately from immutable field modes", () => {
    const config = decodeExecutionState(
      {
        policy: {
          version: 1,
          node_id: "split",
          allocation_mode: ["Percentage"],
          additional_mode: ["Mutable"],
          rows: [
            {
              row_id: "platform",
              recipient_mode: ["Constant"],
              allocation_mode: ["Constant"],
              recipient: a,
              allocation: ["Present", ["Percentage", 1500]],
            },
          ],
        },
        revision: 2n,
        asset: contract(4),
        parent: contract(1),
        min_amount: 0n,
        additional: [{ row_id: "new", recipient: c, allocation: ["Percentage", 8500] }],
      },
      {
        templateKind: "SPLITTER",
        nodeId: "split",
        contractAddress: contract(2),
        confirmedLedger: 10,
      },
    );
    if (config.kind !== "split") throw new Error();
    expect(config.configuration.configuration).toMatchObject({
      additionalRecipients: [
        { rowId: "new", recipient: c, allocation: { kind: "percentage", bps: 8500 } },
      ],
    });
    expect(config.configuration.policy).toMatchObject({
      additionalRecipients: "mutable",
      rows: [{ recipient: "constant", allocation: "constant" }],
    });
  });
});
