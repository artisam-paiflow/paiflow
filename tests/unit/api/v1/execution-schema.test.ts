import { describe, expect, it } from "vitest";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import {
  ExecutionArtifactsSchema,
  ExecutionDiscoverySchema,
  ExecutionReconcileSchema,
  hasExecutionPolicies,
} from "@/lib/api/v1/execution-schema";
const id = "11111111-1111-4111-8111-111111111111";
const root = StrKey.encodeContract(Buffer.alloc(32, 1));
const pay = StrKey.encodeContract(Buffer.alloc(32, 2));
const recipient = Keypair.random().publicKey();
function state() {
  const policy = { kind: "pay", nodeId: "pay", recipient: "constant", payoutValue: "constant" };
  const capabilities = {
    policyVersion: 1,
    executionAbi: 1,
    execution: true,
    mutation: false,
    immutablePolicies: true,
    revisionBinding: true,
    wasmHash: "aa".repeat(32),
  };
  return {
    supported: true,
    deploymentId: id,
    network: "testnet",
    policyVersion: 1,
    confirmedLedger: 10,
    rootContract: root,
    assetContract: root,
    minAmountStroops: "0",
    policies: { version: 1, nodes: [policy] },
    nodes: [
      {
        nodeId: "root",
        contractAddress: root,
        expectedRevision: "0",
        capabilities: { ...capabilities },
      },
      {
        nodeId: "pay",
        contractAddress: pay,
        expectedRevision: "0",
        capabilities: { ...capabilities },
      },
    ],
    configurations: [
      {
        version: 1,
        nodeId: "pay",
        contractAddress: pay,
        confirmedLedger: 10,
        revision: "0",
        policy,
        configuration: { kind: "pay", recipient, payoutValue: { kind: "full" } },
      },
    ],
  };
}
describe("execution response/reconciliation contracts", () => {
  it("accepts complete configuration evidence and explicit legacy unavailability", () => {
    expect(ExecutionDiscoverySchema.safeParse(state()).success).toBe(true);
    expect(
      ExecutionDiscoverySchema.safeParse({
        supported: false,
        policyVersion: 0,
        deploymentId: id,
        network: "testnet",
        reason: "Legacy",
      }).success,
    ).toBe(true);
  });
  it.each(["root", "revision", "ledger", "duplicate", "legacy-capability", "mutation"])(
    "refuses inconsistent %s evidence",
    (field) => {
      const value = state();
      if (field === "root") value.rootContract = pay;
      if (field === "revision") value.configurations[0]!.revision = "1";
      if (field === "ledger") value.configurations[0]!.confirmedLedger = 9;
      if (field === "duplicate") value.nodes[1]!.contractAddress = root;
      if (field === "legacy-capability")
        Object.assign(value.nodes[0]!.capabilities, { policyVersion: 0, execution: false });
      if (field === "mutation") value.nodes[0]!.capabilities.mutation = true;
      expect(ExecutionDiscoverySchema.safeParse(value).success).toBe(false);
    },
  );
  it("requires explicit receipt identity and rejects replacement hashes/unknown request fields", () => {
    expect(ExecutionReconcileSchema.parse({ intent: id })).toEqual({ intent: id });
    expect(
      ExecutionReconcileSchema.safeParse({ intent: id, txHash: "aa".repeat(32) }).success,
    ).toBe(false);
    expect(ExecutionReconcileSchema.safeParse({ intent: "not-a-uuid" }).success).toBe(false);
  });
  it("requires unique exact artifact/path bindings", () => {
    const artifacts = [
      { nodeId: "root", contractAddress: root, wasmHash: "ab".repeat(32) },
      { nodeId: "pay", contractAddress: pay, wasmHash: "cd".repeat(32) },
    ];
    expect(ExecutionArtifactsSchema.safeParse(artifacts).success).toBe(true);
    expect(ExecutionArtifactsSchema.safeParse([artifacts[0], artifacts[0]]).success).toBe(false);
    expect(
      ExecutionArtifactsSchema.safeParse([{ ...artifacts[0], wasmHash: "unknown" }, artifacts[1]])
        .success,
    ).toBe(false);
    expect(
      ExecutionArtifactsSchema.safeParse([{ ...artifacts[0], override: true }, artifacts[1]])
        .success,
    ).toBe(false);
  });
  it("does not silently reinterpret malformed policy declarations as legacy", () => {
    expect(hasExecutionPolicies({})).toBe(false);
    expect(hasExecutionPolicies({ fieldPolicies: null })).toBe(true);
    expect(hasExecutionPolicies({ fieldPolicies: { version: 99 } })).toBe(true);
  });
});
