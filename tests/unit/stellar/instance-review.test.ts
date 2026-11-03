import {
  Address,
  Networks,
  StrKey,
  TransactionBuilder,
  type Transaction,
} from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { flowToPipeline } from "@/lib/flows/to-params";
import { InstanceSnapshotSchema } from "@/lib/flow-instances/schema";
import { InstanceCompiledTermsSchema } from "@/lib/flow-instances/compiled-review-schema";
import { EXECUTION_V1_WASM_HASHES } from "@/lib/stellar/execution-artifacts";
import { paymentAccountResponse } from "./payment-account-fixture";

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  simulate: vi.fn(),
  assemble: vi.fn(),
  poisoned: false,
  relayer: undefined as string | undefined,
  router: undefined as string | undefined,
}));
vi.mock("@/lib/env", async (original) => {
  const actual = await original<typeof import("@/lib/env")>();
  const check = () => {
    if (mocks.poisoned) throw new Error("Current environment must not be read during review");
  };
  return {
    ...actual,
    env: () => {
      check();
      return actual.env();
    },
    stellarPassphrase: () => {
      check();
      return Networks.TESTNET;
    },
    stellarRelayerAddress: () => {
      check();
      return mocks.relayer;
    },
    soroswapRouterAddress: () => {
      check();
      return mocks.router;
    },
  };
});
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ _getLedgerEntries: mocks.account, simulateTransaction: mocks.simulate }),
  horizon: () => ({}),
}));
vi.mock("@stellar/stellar-sdk", async (original) => {
  const actual = await original<typeof import("@stellar/stellar-sdk")>();
  return { ...actual, rpc: { ...actual.rpc, assembleTransaction: mocks.assemble } };
});
vi.mock("@/lib/deployments/service-work", () => ({ prepareServiceDeployment: vi.fn() }));
import { preparePipelineDeployTx } from "@/lib/stellar/deploy";
import { preparedInstanceTerms } from "@/lib/stellar/instance-review";

const source = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const recipient = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
const relayer = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 8));
const router = StrKey.encodeContract(Buffer.alloc(32, 9));
const factoryAddress = StrKey.encodeContract(Buffer.alloc(32, 10));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.poisoned = false;
  mocks.relayer = undefined;
  mocks.router = router;
  mocks.account.mockResolvedValue(paymentAccountResponse(source, "1"));
  mocks.simulate.mockResolvedValue({});
  mocks.assemble.mockImplementation((tx: Transaction) => ({ build: () => tx }));
});
function graph(kind: "swap" | "lock" | "branch" | "policy") {
  const native = { kind: "native" },
    usdc = { kind: "known", symbol: "USDC" };
  const receive = { id: "root", type: "on_receive", config: { asset: native } };
  const pay = (id: string, asset = native) => ({
    id,
    type: "pay",
    config: { asset, recipient, fullAmount: true },
  });
  if (kind === "swap")
    return FlowGraphSchema.parse({
      nodes: [
        receive,
        { id: "swap", type: "swap", config: { assetIn: native, assetOut: usdc } },
        pay("pay", usdc),
      ],
      edges: [
        { id: "a", source: "root", target: "swap" },
        { id: "b", source: "swap", target: "pay" },
      ],
    });
  if (kind === "policy")
    return FlowGraphSchema.parse({
      nodes: [receive, pay("pay")],
      edges: [{ id: "a", source: "root", target: "pay" }],
      fieldPolicies: {
        version: 1,
        nodes: [{ nodeId: "pay", kind: "pay", recipient: "constant", payoutValue: "constant" }],
      },
    });
  return FlowGraphSchema.parse({
    nodes: [
      receive,
      { id: "lock", type: "condition", config: { kind: "time_after", at: "2030-01-01T00:00:00Z" } },
      kind === "lock" ? { id: "before", type: "hold", config: {} } : pay("before"),
      pay("after"),
    ],
    edges: [
      { id: "a", source: "root", target: "lock" },
      { id: "b", source: "lock", target: "before", sourceHandle: "false" },
      { id: "c", source: "lock", target: "after", sourceHandle: "true" },
    ],
  });
}
async function fixture(kind: "swap" | "lock" | "branch" | "policy") {
  const value = graph(kind);
  const pipeline = flowToPipeline(value, mocks.relayer, { ownerAddress: source });
  const maxTime = Math.floor(Date.now() / 1000) + 180;
  const nodes = pipeline.map((node) => ({
    ...node,
    wasmHash:
      kind === "policy"
        ? EXECUTION_V1_WASM_HASHES[node.templateKind as keyof typeof EXECUTION_V1_WASM_HASHES]
        : "a".repeat(64),
  }));
  const prepared = await preparePipelineDeployTx({
    sourceAccount: source,
    graph: value,
    nodes,
    pinned: { factoryAddress, maxTime },
  });
  return {
    unsignedXdr: prepared.xdr,
    preparedTxHash: TransactionBuilder.fromXDR(prepared.xdr, Networks.TESTNET)
      .hash()
      .toString("hex"),
    pipelineSnapshot: prepared.pipeline,
    graph: value,
    compiledTerms: InstanceCompiledTermsSchema.parse(pipeline),
    snapshot: InstanceSnapshotSchema.parse({
      version: 1,
      templateId: "11111111-1111-4111-8111-111111111111",
      templateVersionId: "22222222-2222-4222-8222-222222222222",
      templateVersion: 1,
      contentHash: "b".repeat(64),
      ownerId: "33333333-3333-4333-8333-333333333333",
      sourceAccount: source,
      network: "testnet",
      bindings: {
        version: 1,
        templateVersionId: "22222222-2222-4222-8222-222222222222",
        values: [],
      },
      artifacts: {
        version: 1,
        compilerAbi: 1,
        factoryAddress,
        factoryWasmHash: "c".repeat(64),
        nodes: nodes.map((node) => ({
          nodeId: node.nodeId,
          templateKind: node.templateKind,
          wasmHash: node.wasmHash,
          abiHash: "d".repeat(64),
          policyVersion: kind === "policy" ? 1 : 0,
        })),
      },
      maxTime,
    }),
  };
}
describe("exact saved instance envelope review", () => {
  it("validates policy-aware root/child constructors and refuses altered stored policy bindings", async () => {
    const f = await fixture("policy");
    mocks.poisoned = true;
    expect(preparedInstanceTerms(f)).toEqual(f.compiledTerms);
    const changed = structuredClone(f);
    const pay = changed.compiledTerms.find((n) => n.params.kind === "payer")!;
    if (pay.params.kind !== "payer" || !pay.params.fieldPolicy) throw new Error("fixture");
    pay.params.fieldPolicy.recipient = "execution";
    expect(() => preparedInstanceTerms(changed)).toThrow(/constructor evidence/);
  });
  it("recovers final swap router missing from compiler output after current environment changes", async () => {
    const f = await fixture("swap");
    expect(f.compiledTerms.find((n) => n.params.kind === "swapper")?.params).not.toHaveProperty(
      "router",
    );
    mocks.router = StrKey.encodeContract(Buffer.alloc(32, 20));
    mocks.poisoned = true;
    const terms = preparedInstanceTerms(f);
    expect(terms.find((n) => n.params.kind === "swapper")?.params).toHaveProperty("router", router);
    expect(preparedInstanceTerms(structuredClone(f))).toEqual(terms);
  });
  it.each(["lock", "branch"] as const)(
    "recovers %s global relayer or source fallback without consulting current settings",
    async (kind) => {
      for (const configured of [undefined, relayer]) {
        mocks.poisoned = false;
        mocks.relayer = configured;
        const f = await fixture(kind);
        mocks.relayer = recipient;
        mocks.poisoned = true;
        const terms = preparedInstanceTerms(f);
        expect(
          terms.find((n) => n.params.kind === "timelock" || n.params.kind === "timelock_branch")
            ?.params,
        ).toHaveProperty("relayer", configured ?? source);
        expect(preparedInstanceTerms(structuredClone(f))).toEqual(terms);
      }
    },
  );
  it("refuses missing/hash-mismatched/foreign-factory evidence and altered amounts, topology or node references", async () => {
    const f = await fixture("swap");
    const amount = structuredClone(f);
    const pay = amount.compiledTerms.find((n) => n.params.kind === "payer")!;
    if (pay.params.kind !== "payer") throw new Error();
    pay.params.amountStroops = "99";
    const topology = structuredClone(f);
    topology.graph.edges[1]!.source = "root";
    const refs = structuredClone(f);
    refs.pipelineSnapshot[0]!.contractAddress = factoryAddress;
    const artifacts = structuredClone(f);
    artifacts.snapshot.artifacts.nodes[0]!.wasmHash = "f".repeat(64);
    for (const changed of [
      { ...f, unsignedXdr: null },
      { ...f, preparedTxHash: "f".repeat(64) },
      { ...f, snapshot: { ...f.snapshot, sourceAccount: recipient } },
      { ...f, snapshot: { ...f.snapshot, network: "mainnet" as const } },
      {
        ...f,
        snapshot: { ...f.snapshot, artifacts: { ...f.snapshot.artifacts, factoryAddress: router } },
      },
      amount,
      topology,
      refs,
      artifacts,
    ])
      expect(() => preparedInstanceTerms(changed)).toThrow(/constructor evidence/);
  });
});
