import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  SorobanDataBuilder,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  hashes: vi.fn(),
  factory: vi.fn(),
  load: vi.fn(),
  simulate: vi.fn(),
}));
vi.mock("@/lib/stellar/config", () => ({
  getWasmHashes: mocks.hashes,
  getFactoryAddress: mocks.factory,
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ simulateTransaction: mocks.simulate }),
}));
vi.mock("@/lib/stellar/load-payment-account", () => ({ loadPaymentAccount: mocks.load }));
import {
  conditionalDeploymentPlan,
  prepareConditionalDeployTransaction,
  verifyConditionalDeploymentOriginal,
} from "@/lib/stellar/prepare-conditional-deploy";
import { verifyConditionalDeploymentReview } from "@/lib/stellar/conditional-deployment-review";
import { CONDITIONAL_V2_WASM_HASHES } from "@/lib/stellar/conditional-artifacts";
import { ConditionalCanvasSchema } from "@/lib/flows/conditional-canvas-schema";
import { conditionalDeployCanvas } from "@/tests/fixtures/conditional-deploy";
const id = "12271227-1227-4227-8227-122712271227";
const factory = Address.contract(Buffer.alloc(32, 66)).toString();
function simulation() {
  return {
    _parsed: true,
    id: "1",
    latestLedger: 100,
    minResourceFee: "1000",
    transactionData: new SorobanDataBuilder().setResourceFee("1000"),
    result: { retval: xdr.ScVal.scvVoid(), auth: [] },
    events: [],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.hashes.mockResolvedValue(new Map(Object.entries(CONDITIONAL_V2_WASM_HASHES)));
  mocks.factory.mockResolvedValue(factory);
  mocks.load.mockImplementation(async (_s: unknown, address: string) => new Account(address, "10"));
  mocks.simulate.mockResolvedValue(simulation());
});
async function original() {
  const { graph, owner } = conditionalDeployCanvas();
  const plan = await conditionalDeploymentPlan(graph, owner);
  const prepared = await prepareConditionalDeployTransaction(plan, id);
  return {
    ...prepared,
    id,
    network: "testnet",
    sourceAccount: owner,
    unsignedXdr: prepared.xdr,
    preparedTxHash: prepared.conditionalReview.txHash,
    graphSnapshot: graph,
    paramsSnapshot: plan.envelope,
    pipelineSnapshot: plan.pipeline,
  };
}
describe("conditional deployment original construction", () => {
  it("compiles all nodes, complete branch evidence and immutable owner return with fresh32byte salts", async () => {
    const d = await original();
    const got = verifyConditionalDeploymentOriginal(d, factory);
    expect(got.pipeline).toHaveLength(5);
    expect(new Set(got.pipeline.map((n) => n.salt)).size).toBe(5);
    expect(got.envelope.nodes.at(-1)!.initialState.configuration).toEqual({
      kind: "return_to_owner",
      recipient: d.sourceAccount,
    });
    expect(got.tx.source).toBe(d.sourceAccount);
    expect(
      BigInt(got.tx.timeBounds!.maxTime) - BigInt(Math.floor(Date.now() / 1000)),
    ).toBeLessThanOrEqual(180n);
    expect(got.tx.signatures).toHaveLength(0);
    expect(
      verifyConditionalDeploymentReview(d.conditionalReview, {
        deploymentId: id,
        xdr: d.xdr,
        sourceAccount: d.sourceAccount,
        network: "testnet",
        networkPassphrase: Networks.TESTNET,
      }).review,
    ).toEqual(d.conditionalReview);
  });
  it("rejects missing or wrong authoritative pins before account/simulation", async () => {
    const { graph, owner } = conditionalDeployCanvas();
    mocks.hashes.mockResolvedValue(new Map([["DEPOSIT_TRIGGER", "a".repeat(64)]]));
    await expect(conditionalDeploymentPlan(graph, owner)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.simulate).not.toHaveBeenCalled();
  });
  it("does not require an unused Split family", async () => {
    const { graph, owner } = conditionalDeployCanvas();
    mocks.hashes.mockResolvedValue(
      new Map(Object.entries(CONDITIONAL_V2_WASM_HASHES).filter(([kind]) => kind !== "SPLITTER")),
    );
    await expect(conditionalDeploymentPlan(graph, owner)).resolves.toHaveProperty("pipeline");
  });
  it.each(["salt", "pin", "owner", "canvas", "hash", "missingHash"])(
    "rejects inconsistent retained %s evidence",
    async (field) => {
      const d = await original();
      if (field === "salt") d.pipelineSnapshot[0]!.salt = "00".repeat(32);
      if (field === "pin") d.pipelineSnapshot[0]!.wasmHash = "a".repeat(64);
      if (field === "owner") d.sourceAccount = Keypair.random().publicKey();
      if (field === "canvas") {
        const n = d.graphSnapshot.nodes.find((n) => n.type === "condition");
        if (n?.type === "condition" && n.config.kind === "amount_gt")
          n.config.amountStroops = "501";
      }
      if (field === "hash") d.preparedTxHash = "a".repeat(64);
      if (field === "missingHash") d.preparedTxHash = "";
      expect(() => verifyConditionalDeploymentOriginal(d)).toThrow();
    },
  );
  it("registry rotation blocks new signing but original verification remains possible afterclaim", async () => {
    const d = await original();
    expect(() =>
      verifyConditionalDeploymentOriginal(d, Address.contract(Buffer.alloc(32, 67)).toString()),
    ).toThrow();
    expect(verifyConditionalDeploymentOriginal(d).conditionalReview.txHash).toBe(d.preparedTxHash);
  });
  it("refuses an incorrect compiled review against the exact unsigned transaction", async () => {
    const d = await original();
    const bad = { ...d.conditionalReview, txHash: "a".repeat(64) };
    expect(() =>
      verifyConditionalDeploymentReview(bad, {
        deploymentId: id,
        xdr: d.xdr,
        sourceAccount: d.sourceAccount,
        network: "testnet",
        networkPassphrase: Networks.TESTNET,
      }),
    ).toThrow();
  });
  it("advisory destinations include configured mutable roster and owner but exclude execution-only recipients", async () => {
    const { graph, owner, payer } = conditionalDeployCanvas();
    const draft = ConditionalCanvasSchema.parse({
      ...graph,
      conditionalPolicies: {
        ...graph.conditionalPolicies,
        nodes: [
          { nodeId: "prefix", kind: "pay", recipient: "execution", payoutValue: "constant" },
          {
            nodeId: "yes",
            kind: "split",
            allocationMode: "percentage",
            rows: [{ rowId: "base", recipient: "constant", allocation: "constant" }],
            additionalRecipients: "mutable",
          },
        ],
      },
      nodes: graph.nodes.map((node) =>
        node.id === "yes"
          ? {
              id: "yes",
              type: "split",
              config: {
                asset: { kind: "native" },
                recipients: [{ rowId: "base", address: payer, mode: "percentage", bps: 5000 }],
                additionalRecipients: [
                  {
                    rowId: "additional",
                    recipient: owner,
                    allocation: { kind: "percentage", bps: 5000 },
                  },
                ],
              },
            }
          : node,
      ),
    });
    const plan = await conditionalDeploymentPlan(draft, owner);
    expect(plan.recipients.map(({ nodeId, address }) => ({ nodeId, address }))).toEqual([
      { nodeId: "yes", address: payer },
      { nodeId: "yes", address: owner },
      { nodeId: "no", address: owner },
    ]);
  });
  it("incorrect loaded source account cannot produce a deployment", async () => {
    const { graph, owner } = conditionalDeployCanvas();
    const plan = await conditionalDeploymentPlan(graph, owner);
    mocks.load.mockResolvedValue(new Account(Keypair.random().publicKey(), "10"));
    await expect(prepareConditionalDeployTransaction(plan, id)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(mocks.simulate).not.toHaveBeenCalled();
  });
  it("incomplete saved conditional drafts fail validation before account or simulation", async () => {
    const { graph, owner } = conditionalDeployCanvas();
    graph.edges = graph.edges.filter((edge) => edge.sourceHandle !== "false");
    await expect(conditionalDeploymentPlan(graph, owner)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.simulate).not.toHaveBeenCalled();
  });
  it("simulation failure never returns signing evidence", async () => {
    const { graph, owner } = conditionalDeployCanvas();
    const plan = await conditionalDeploymentPlan(graph, owner);
    mocks.simulate.mockResolvedValue({ error: "contract rejected", events: [] });
    await expect(prepareConditionalDeployTransaction(plan, id)).rejects.toThrow();
  });
});
