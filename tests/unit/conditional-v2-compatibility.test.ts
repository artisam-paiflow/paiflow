import { beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Keypair, SorobanDataBuilder, StrKey, xdr } from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
import { FlowGraphSchema, type FlowGraph } from "@/lib/flows/schema";
import { compileExecutionPipeline } from "@/lib/flows/execution-v1";
import { flowToPipeline } from "@/lib/flows/to-params";
import { validateFlow } from "@/lib/flows/validate";
import { ExecutionIntentSchema } from "@/lib/flows/field-policies";
import { MutationIntentSchema } from "@/lib/mutations/schema";
import {
  assertExecutionArtifact,
  assertMutationArtifact,
  executionArtifactMetadata,
  EXECUTION_V1_WASM_HASHES,
  MUTATION_V1_WASM_HASHES,
} from "@/lib/stellar/execution-artifacts";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), account: vi.fn(), simulate: vi.fn() }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => {
    mock.rpc();
    return { simulateTransaction: mock.simulate };
  },
  horizon: () => ({}),
}));
vi.mock("@/lib/stellar/load-payment-account", () => ({ loadPaymentAccount: mock.account }));
vi.mock("@/lib/mutations/history", () => ({ recordConfigurationObservation: vi.fn() }));
vi.mock("@/lib/stellar/config", () => ({ getFactoryAddress: vi.fn() }));
import { preparePipelineDeployTx } from "@/lib/stellar/deploy";
import { readExecutionState } from "@/lib/stellar/execution-state";
import { readMutationState } from "@/lib/stellar/mutation-state";
import { prepareExecutionTransaction } from "@/lib/stellar/prepare-execution";
import { prepareMutationTransaction } from "@/lib/stellar/prepare-mutation";

const wallet = Keypair.random().publicKey();
const root = StrKey.encodeContract(Buffer.alloc(32, 1));
const pay = StrKey.encodeContract(Buffer.alloc(32, 2));
const asset = StrKey.encodeContract(Buffer.alloc(32, 3));
const deploymentId = "11111111-1111-4111-8111-111111111111";
const legacy = {
  nodes: [
    { id: "root", type: "on_receive", config: { asset: { kind: "native" } } },
    {
      id: "pay",
      type: "pay",
      config: { asset: { kind: "native" }, recipient: wallet, fullAmount: true },
    },
  ],
  edges: [{ id: "edge", source: "root", target: "pay" }],
};
const policyV1 = {
  ...legacy,
  fieldPolicies: { version: 1, nodes: [] },
};
const bindings = [
  { nodeId: "root", contractAddress: root, expectedRevision: "0" },
  { nodeId: "pay", contractAddress: pay, expectedRevision: "0" },
];
const execution = ExecutionIntentSchema.parse({
  version: 1,
  deploymentId,
  networkPassphraseHash: "a".repeat(64),
  rootContract: root,
  assetContract: asset,
  payer: wallet,
  amountStroops: "10",
  nonce: "b".repeat(64),
  expiresAtLedger: 100,
  nodes: bindings,
  arguments: { version: 1, inputs: [] },
});
const mutation = MutationIntentSchema.parse({
  version: 1,
  deploymentId,
  network: "testnet",
  admin: wallet,
  rootContract: root,
  nodes: bindings,
  arguments: {
    version: 1,
    changes: [
      {
        kind: "pay",
        nodeId: "pay",
        expectedRevision: "0",
        recipient: Keypair.random().publicKey(),
      },
    ],
  },
  artifacts: bindings.map(({ nodeId, contractAddress }, index) => ({
    nodeId,
    contractAddress,
    wasmHash: index === 0 ? MUTATION_V1_WASM_HASHES.DEPOSIT_TRIGGER : MUTATION_V1_WASM_HASHES.PAYER,
  })),
});
function deployment(graphSnapshot: unknown): Deployment {
  return {
    id: deploymentId,
    status: "CONFIRMED",
    network: "testnet",
    sourceAccount: wallet,
    graphSnapshot,
    pipelineSnapshot: [],
    paramsSnapshot: [],
  } as unknown as Deployment;
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.account.mockResolvedValue(new Account(wallet, "10"));
  mock.simulate.mockResolvedValue({
    _parsed: true,
    id: "conditional-foundation",
    transactionData: new SorobanDataBuilder().setResourceFee("1000"),
    minResourceFee: "1000",
    latestLedger: 10,
    result: { retval: xdr.ScVal.scvVoid(), auth: [] },
    events: [],
  });
});

describe("conditional foundation cannot enable runtime generations", () => {
  it.each(["version", "root", "prefix", "condition", "trueBranch", "falseBranch"])(
    "rejects reserved normalized %s before a valid legacy graph can strip it",
    async (key) => {
      const mixed = { ...legacy, [key]: key === "version" ? 2 : null };
      expect(FlowGraphSchema.safeParse(mixed).success).toBe(false);
      expect(validateFlow(mixed).ok).toBe(false);
      expect(() => flowToPipeline(mixed as FlowGraph)).toThrow(/Conditional-v2/);
      expect(() =>
        compileExecutionPipeline({ ...mixed, fieldPolicies: policyV1.fieldPolicies } as FlowGraph),
      ).toThrow(/Conditional-v2/);
      await expect(
        preparePipelineDeployTx({ sourceAccount: wallet, graph: mixed as FlowGraph, nodes: [] }),
      ).rejects.toThrow(/Conditional-v2/);
      await expect(readExecutionState(deployment(mixed))).rejects.toThrow(/Conditional-v2/);
      await expect(readMutationState(deployment(mixed))).rejects.toThrow(/Conditional-v2/);
      expect(mock.rpc).not.toHaveBeenCalled();
      expect(mock.account).not.toHaveBeenCalled();
    },
  );
  it("rejects a v2 field policy and v1 conditional topology at the compiler boundary", () => {
    const unsupported = { ...legacy, fieldPolicies: { version: 2, nodes: [] } };
    expect(FlowGraphSchema.safeParse(unsupported).success).toBe(false);
    expect(() => flowToPipeline(unsupported as unknown as FlowGraph)).toThrow();
    expect(() => compileExecutionPipeline(unsupported as unknown as FlowGraph)).toThrow();
    const branched = FlowGraphSchema.parse({
      ...policyV1,
      nodes: [
        ...legacy.nodes,
        { id: "condition", type: "condition", config: { kind: "amount_gt", amountStroops: "1" } },
      ],
      edges: [
        { id: "a", source: "root", target: "condition" },
        { id: "b", source: "condition", target: "pay", sourceHandle: "true" },
      ],
    });
    expect(() => flowToPipeline(branched)).toThrow(/cannot forward immediate/);
  });
  it("rejects conditional execution and mutation versions before account reads or simulation", async () => {
    await expect(
      prepareExecutionTransaction({ ...execution, version: 2 } as unknown as typeof execution),
    ).rejects.toThrow();
    await expect(
      prepareExecutionTransaction({
        ...execution,
        arguments: { version: 2, inputs: [] },
      } as unknown as typeof execution),
    ).rejects.toThrow();
    await expect(
      prepareMutationTransaction({ ...mutation, version: 2 } as unknown as typeof mutation),
    ).rejects.toThrow();
    await expect(
      prepareMutationTransaction({
        ...mutation,
        arguments: { version: 2, changes: mutation.arguments.changes },
      } as unknown as typeof mutation),
    ).rejects.toThrow();
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.account).not.toHaveBeenCalled();
    expect(mock.simulate).not.toHaveBeenCalled();
  });
  it("retains legacy and immediate v1 compilation, intent encoding and reviewed artifact pins", async () => {
    expect(flowToPipeline(FlowGraphSchema.parse(legacy))).toHaveLength(2);
    expect(flowToPipeline(FlowGraphSchema.parse(policyV1))).toHaveLength(2);
    expect((await readExecutionState(deployment(legacy))).supported).toBe(false);
    await expect(prepareExecutionTransaction(execution)).resolves.toHaveProperty("xdr");
    await expect(prepareMutationTransaction(mutation)).resolves.toBeTypeOf("string");
    for (const [kind, hash] of Object.entries(EXECUTION_V1_WASM_HASHES)) {
      expect(() => assertExecutionArtifact(kind, hash)).not.toThrow();
      expect(executionArtifactMetadata(kind, hash)).toMatchObject({
        policyVersion: 1,
        executionAbi: 1,
        mutation: false,
      });
      expect(() => assertMutationArtifact(kind, hash)).toThrow();
    }
    for (const [kind, hash] of Object.entries(MUTATION_V1_WASM_HASHES)) {
      expect(() => assertMutationArtifact(kind, hash)).not.toThrow();
      expect(executionArtifactMetadata(kind, hash)).toMatchObject({
        policyVersion: 1,
        executionAbi: 1,
        mutation: true,
      });
    }
    expect(() => assertExecutionArtifact("ROUTER", "c".repeat(64))).toThrow();
    expect(() => assertExecutionArtifact("PAYER", "c".repeat(64))).toThrow();
  });
});
