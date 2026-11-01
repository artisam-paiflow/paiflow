import { describe, expect, it, vi } from "vitest";
import { scValToNative, StrKey } from "@stellar/stellar-sdk";
import { FlowGraphSchema, getPendingLabels } from "@/lib/flows/schema";
import { flowToPipeline } from "@/lib/flows/to-params";
import { validateFlow } from "@/lib/flows/validate";
import { executionPolicy } from "@/lib/flows/execution-v1";
import { ExecutionIntentSchema } from "@/lib/flows/field-policies";
import { pipelineNodeConstructorArgs } from "@/lib/stellar/scval";
import {
  decodeExecutionCapabilities,
  decodeExecutionState,
  executionV1Args,
} from "@/lib/stellar/execution-v1";
import {
  assertExecutionArtifact,
  executionArtifactMetadata,
  EXECUTION_V1_WASM_HASHES,
} from "@/lib/stellar/execution-artifacts";

const a = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
const b = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const root = StrKey.encodeContract(Buffer.alloc(32, 3));
const split = StrKey.encodeContract(Buffer.alloc(32, 4));
const assetContract = StrKey.encodeContract(Buffer.alloc(32, 5));
const asset = { kind: "native" } as const;
vi.mock("@/lib/stellar/assets", () => ({
  assetContractId: () => StrKey.encodeContract(Buffer.alloc(32, 5)),
}));
function graph() {
  return FlowGraphSchema.parse({
    nodes: [
      { id: "root", type: "on_receive", config: { asset, minAmountStroops: "2" } },
      {
        id: "split",
        type: "split",
        config: {
          asset,
          recipients: [{ rowId: "platform", address: a, mode: "percentage", bps: 1000 }],
        },
      },
    ],
    edges: [{ id: "edge", source: "root", target: "split" }],
    fieldPolicies: {
      version: 1,
      nodes: [
        {
          kind: "split",
          nodeId: "split",
          allocationMode: "percentage",
          rows: [{ rowId: "platform" }],
          additionalRecipients: "execution",
        },
      ],
    },
  });
}
describe("execution v1 compiler and ABI", () => {
  it("keeps constant platform terms, tags execution absence and preserves old constructor arity", () => {
    const value = graph();
    expect(validateFlow(value).ok).toBe(true);
    const nodes = flowToPipeline(value);
    const rootArgs = pipelineNodeConstructorArgs(nodes[0]!.params, a, undefined, { root, split });
    const splitArgs = pipelineNodeConstructorArgs(nodes[1]!.params, a, root, { root, split });
    expect(rootArgs).toHaveLength(3);
    expect(splitArgs).toHaveLength(6);
    expect(scValToNative(rootArgs[2]!)).toEqual({
      min_amount: 2n,
      next_steps: [{ address: split, data: "" }],
      node_id: "root",
      version: 1,
    });
    expect(scValToNative(splitArgs[2]!)).toMatchObject({
      allocation_mode: ["Percentage"],
      additional_mode: ["Execution"],
      rows: [
        {
          row_id: "platform",
          recipient: a,
          allocation: ["Present", ["Percentage", 1000]],
          recipient_mode: ["Constant"],
          allocation_mode: ["Constant"],
        },
      ],
    });
  });
  it("never stores a draft fallback recipient or amount for execution fields", () => {
    const value = FlowGraphSchema.parse({
      ...graph(),
      nodes: [
        graph().nodes[0],
        {
          id: "pay",
          type: "pay",
          config: { asset, recipient: "PENDING:worker", fullAmount: true },
        },
      ],
      edges: [{ id: "edge", source: "root", target: "pay" }],
      fieldPolicies: {
        version: 1,
        nodes: [{ kind: "pay", nodeId: "pay", recipient: "execution" }],
      },
    });
    expect(getPendingLabels(value)).toEqual([]);
    expect(validateFlow(value).ok).toBe(true);
    const args = pipelineNodeConstructorArgs(flowToPipeline(value)[1]!.params, a, root, {
      root,
      pay: split,
    });
    expect(args).toHaveLength(7);
    expect(scValToNative(args[2]!)).toEqual({
      node_id: "pay",
      payout_rule: ["Full"],
      payout_value_mode: ["Constant"],
      recipient: null,
      recipient_mode: ["Execution"],
      version: 1,
    });
  });
  it("derives stable constant row IDs when an explicit table omits a Split entry", () => {
    const value = FlowGraphSchema.parse({
      ...graph(),
      fieldPolicies: { version: 1, nodes: [] },
      nodes: [
        graph().nodes[0],
        {
          id: "split",
          type: "split",
          config: { asset, recipients: [{ address: a, mode: "percentage", bps: 10_000 }] },
        },
      ],
    });
    expect(executionPolicy(value, value.nodes[1]!)).toMatchObject({
      rows: [{ rowId: "row-1", recipient: "constant", allocation: "constant" }],
    });
    expect(flowToPipeline(value)[1]!.params).toHaveProperty("fieldPolicy.rows.0.rowId", "row-1");
  });
  it.each(["mutable", "wrong asset", "cycle", "extra node", "fanout", "constant total"])(
    "refuses unsupported or inconsistent source policies: %s",
    (attack) => {
      const raw = structuredClone(graph());
      if (attack === "mutable") {
        const policy = raw.fieldPolicies!.nodes[0]!;
        if (policy.kind === "split") policy.additionalRecipients = "mutable";
      }
      if (attack === "wrong asset") {
        const node = raw.nodes[1]!;
        if (node.type === "split") node.config.asset = { kind: "known", symbol: "USDC" };
      }
      if (attack === "cycle") raw.edges.push({ id: "back", source: "split", target: "root" });
      if (attack === "extra node")
        raw.nodes.push({ id: "extra", type: "on_receive", config: { asset } });
      if (attack === "fanout") raw.edges.push({ id: "twice", source: "root", target: "split" });
      if (attack === "constant total") {
        const node = raw.nodes[1]!;
        if (node.type === "split" && node.config.recipients[0]?.mode === "percentage")
          node.config.recipients[0].bps = 10_001;
      }
      expect(validateFlow(raw).ok).toBe(false);
      expect(() => flowToPipeline(raw)).toThrow();
    },
  );
  it("encodes payer, asset, funded amount, nonce, expiry, full revisions and exact node inputs", () => {
    const intent = ExecutionIntentSchema.parse({
      version: 1,
      deploymentId: "00000000-0000-4000-8000-000000000001",
      networkPassphraseHash: "a".repeat(64),
      rootContract: root,
      assetContract,
      payer: a,
      amountStroops: "9007199254740993",
      nonce: "b".repeat(64),
      expiresAtLedger: 100,
      nodes: [
        { nodeId: "root", contractAddress: root, expectedRevision: "0" },
        { nodeId: "split", contractAddress: split, expectedRevision: "18446744073709551615" },
      ],
      arguments: {
        version: 1,
        inputs: [
          {
            kind: "split",
            nodeId: "split",
            rows: [],
            additionalRecipients: [
              {
                rowId: "worker",
                recipient: b,
                allocation: { kind: "fixed", amountStroops: "9007199254740993" },
              },
            ],
          },
        ],
      },
    });
    const native = executionV1Args(intent).map(scValToNative);
    expect(native.slice(0, 3)).toEqual([a, assetContract, 9007199254740993n]);
    expect(native[3]).toEqual(Buffer.from("b".repeat(64), "hex"));
    expect(native[4]).toBe(100);
    expect(native[5]).toEqual([
      { contract_address: root, expected_revision: 0n, node_id: "root" },
      { contract_address: split, expected_revision: 18446744073709551615n, node_id: "split" },
    ]);
    expect(native[6]).toMatchObject([
      [
        "Split",
        {
          additional: [
            { row_id: "worker", recipient: b, allocation: ["Fixed", 9007199254740993n] },
          ],
          node_id: "split",
          rows: [],
        },
      ],
    ]);
  });
});
describe("confirmed getter and artifact decoding", () => {
  const binding = {
    nodeId: "pay",
    contractAddress: split,
    confirmedLedger: 30,
    templateKind: "PAYER",
  };
  const state = () => ({
    policy: {
      version: 1,
      node_id: "pay",
      recipient_mode: ["Execution"],
      payout_value_mode: ["Constant"],
      recipient: null,
      payout_rule: ["Fixed", 10n],
    },
    revision: 0n,
    asset: assetContract,
    parent: root,
    next_steps: [],
    amount: 10n,
    percentage_bps: 0,
  });
  it("returns absent runtime values with confirmed immutable policy and revision", () => {
    const result = decodeExecutionState(state(), binding);
    expect(result.kind).toBe("pay");
    if (result.kind !== "on_receive") {
      expect(result.configuration).toMatchObject({
        revision: "0",
        confirmedLedger: 30,
        configuration: { kind: "pay", payoutValue: { kind: "fixed", amountStroops: "10" } },
      });
      expect(result.configuration.configuration).not.toHaveProperty("recipient");
    }
  });
  it.each(["stored fallback", "inconsistent amount", "unknown key", "wrong node", "mutable"])(
    "rejects inconsistent getter result: %s",
    (attack) => {
      const value = state();
      if (attack === "stored fallback") Object.assign(value.policy, { recipient: a });
      if (attack === "inconsistent amount") value.amount = 11n;
      if (attack === "unknown key") Object.assign(value, { upgrade: true });
      if (attack === "wrong node") value.policy.node_id = "other";
      if (attack === "mutable") value.policy.recipient_mode = ["Mutable"];
      expect(() => decodeExecutionState(value, binding)).toThrow();
    },
  );
  it("does not grant capability from an unreviewed hash or false getter label", () => {
    const hash = EXECUTION_V1_WASM_HASHES.PAYER;
    expect(executionArtifactMetadata("PAYER", hash)).toMatchObject({
      wasmHash: hash,
      execution: true,
      mutation: false,
    });
    expect(() => assertExecutionArtifact("PAYER", "a".repeat(64))).toThrow();
    expect(() => assertExecutionArtifact("DEPOSIT_TRIGGER", hash)).toThrow();
    const raw = {
      policy_version: 1,
      execution_abi: 1,
      execution: true,
      mutation: false,
      immutable_policies: true,
      revision_binding: true,
    };
    expect(decodeExecutionCapabilities(raw, hash)).toMatchObject({
      policyVersion: 1,
      wasmHash: hash,
    });
    expect(() =>
      decodeExecutionCapabilities({ ...raw, immutable_policies: false }, hash),
    ).toThrow();
    expect(() => decodeExecutionCapabilities({ ...raw, mutation: true }, hash)).toThrow();
  });
});
