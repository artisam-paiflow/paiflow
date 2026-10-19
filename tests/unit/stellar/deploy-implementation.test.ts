import { Account, Keypair, Networks, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { flowToPipeline } from "@/lib/flows/to-params";

const {
  getAccount,
  simulate,
  assemble,
  prepareSubmission,
  send,
  buildRelayer,
  trackPending,
  clearPending,
  getTransaction,
} = vi.hoisted(() => ({
  getAccount: vi.fn(),
  trackPending: vi.fn(),
  clearPending: vi.fn(),
  getTransaction: vi.fn(),
  simulate: vi.fn(),
  assemble: vi.fn(),
  prepareSubmission: vi.fn(),
  send: vi.fn(),
  buildRelayer: vi.fn(),
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({
    getAccount,
    simulateTransaction: simulate,
    sendTransaction: send,
    getTransaction,
  }),
  horizon: () => ({}),
}));
vi.mock("@/lib/stellar/config", () => ({
  getFactoryAddress: async () => StrKey.encodeContract(Buffer.alloc(32, 1)),
}));
vi.mock("@stellar/stellar-sdk", async (original) => {
  const actual = await original<typeof import("@stellar/stellar-sdk")>();
  return { ...actual, rpc: { ...actual.rpc, assembleTransaction: assemble } };
});
vi.mock("@/lib/deployments/service-work", () => ({ prepareServiceDeployment: prepareSubmission }));
vi.mock("@/lib/analytics/outcomes", () => ({
  beginTransactionSubmission: vi.fn(),
  recordTransactionOutcome: vi.fn(),
  transactionObservation: vi.fn(),
}));
vi.mock("@/lib/stellar/relayer-channels", () => ({
  withRelayerChannel: (fn: (channel: object) => Promise<unknown>) =>
    fn({ trackPending, clearPending }),
  buildRelayerTx: buildRelayer,
}));
import { preparePipelineDeployTx } from "@/lib/stellar/deploy";

const ACCOUNT = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const graph = FlowGraphSchema.parse({
  nodes: [
    {
      id: "t",
      type: "on_schedule",
      config: { startsAt: "2030-01-01T00:00:00Z", intervalAmount: 1, intervalUnit: "day" },
    },
    {
      id: "p",
      type: "pay",
      config: {
        asset: { kind: "native" },
        recipient: ACCOUNT,
        mode: "fixed",
        amountStroops: "100",
        fullAmount: false,
      },
    },
  ],
  edges: [{ id: "tp", source: "t", target: "p" }],
});

beforeEach(() => {
  vi.clearAllMocks();
  getAccount.mockResolvedValue(new Account(ACCOUNT, "1"));
  simulate.mockResolvedValue({});
  assemble.mockImplementation((tx: TransactionBuilder) => ({ build: () => tx }));
});

it("preserves shared bindings alongside the prepared contract address after simulation", async () => {
  const nodes = flowToPipeline(graph).map((node) => ({ ...node, wasmHash: "a".repeat(64) }));
  const result = await preparePipelineDeployTx({ sourceAccount: ACCOUNT, graph, nodes });
  expect(simulate).toHaveBeenCalledTimes(1);
  expect(assemble).toHaveBeenCalledTimes(1);
  expect(result.pipeline).toHaveLength(1);
  expect(result.pipeline[0]).toMatchObject({
    nodeId: "p",
    templateKind: "STREAMER",
    implementation: nodes[0]?.implementation,
  });
  expect(StrKey.isValidContract(result.pipeline[0]!.contractAddress)).toBe(true);
  expect(result.xdr).toBeTruthy();
});

it("rejects missing coverage before loading an account or simulating", async () => {
  const nodes = flowToPipeline(graph).map((node) => ({
    ...node,
    wasmHash: "a".repeat(64),
    implementation: { version: 1 as const, bindings: node.implementation!.bindings.slice(1) },
  }));
  await expect(preparePipelineDeployTx({ sourceAccount: ACCOUNT, graph, nodes })).rejects.toThrow(
    /originating block binding/,
  );
  expect(getAccount).not.toHaveBeenCalled();
  expect(simulate).not.toHaveBeenCalled();
});

afterEach(() => {
  delete process.env.STELLAR_RELAYER_SECRET_KEY;
  delete process.env.STELLAR_RELAYER_ADDRESS;
});
it.each([false, true])(
  "binds the exact signed hash and prepared pipeline to the single send gate (checkpoint error: %s)",
  async (checkpointError) => {
    const relayer = Keypair.random();
    process.env.STELLAR_RELAYER_ADDRESS = relayer.publicKey();
    process.env.STELLAR_RELAYER_SECRET_KEY = relayer.secret();
    vi.resetModules();
    const { deployPipelineByRelayer } = await import("@/lib/stellar/deploy");
    const nodes = flowToPipeline(graph).map((node) => ({ ...node, wasmHash: "a".repeat(64) }));
    let prepared: ReturnType<TransactionBuilder["build"]>;
    buildRelayer.mockImplementation(async ({ operation }) => {
      prepared = new TransactionBuilder(new Account(relayer.publicKey(), "1"), {
        fee: "100",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(operation)
        .setTimeout(180)
        .build();
      return prepared;
    });
    prepareSubmission.mockImplementation((hash, pipeline) => {
      expect(hash).toBe(prepared.hash().toString("hex"));
      expect(pipeline).toHaveLength(nodes.length);
      expect(pipeline[0]).toMatchObject({
        nodeId: nodes[0]!.nodeId,
        templateKind: nodes[0]!.templateKind,
        implementation: nodes[0]!.implementation,
      });
      expect(StrKey.isValidContract(pipeline[0].contractAddress)).toBe(true);
      if (checkpointError) throw new Error("Checkpoint unavailable");
    });
    send.mockImplementation(async (tx) => {
      expect(prepareSubmission).toHaveBeenCalledOnce();
      expect(tx.hash()).toEqual(prepared.hash());
      return { status: "ERROR", hash: tx.hash().toString("hex") };
    });
    if (checkpointError) {
      await expect(deployPipelineByRelayer({ graph, nodes })).rejects.toThrow(
        "Checkpoint unavailable",
      );
      expect(send).not.toHaveBeenCalled();
    } else {
      await expect(deployPipelineByRelayer({ graph, nodes })).resolves.toMatchObject({
        status: "FAILED",
        pipeline: expect.any(Array),
      });
      expect(send).toHaveBeenCalledOnce();
    }
  },
);

it.each(["send-timeout", "read-timeout", "deadline"])(
  "retains the relayer lane for deployment %s",
  async (failure) => {
    const relayer = Keypair.random();
    process.env.STELLAR_RELAYER_ADDRESS = relayer.publicKey();
    process.env.STELLAR_RELAYER_SECRET_KEY = relayer.secret();
    vi.resetModules();
    const { deployPipelineByRelayer } = await import("@/lib/stellar/deploy");
    const nodes = flowToPipeline(graph).map((node) => ({ ...node, wasmHash: "a".repeat(64) }));
    buildRelayer.mockImplementation(async ({ operation }) =>
      new TransactionBuilder(new Account(relayer.publicKey(), "1"), {
        fee: "100",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(operation)
        .setTimeout(180)
        .build(),
    );
    prepareSubmission.mockImplementation(() => undefined);
    send.mockImplementation(async (tx) => {
      expect(trackPending).toHaveBeenCalledWith(tx.hash().toString("hex"), tx.timeBounds.maxTime);
      if (failure === "send-timeout") throw new Error("Acknowledgement timeout");
      return { status: "PENDING", hash: tx.hash().toString("hex") };
    });
    if (failure === "read-timeout") getTransaction.mockRejectedValue(new Error("Read timeout"));
    else getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
    if (failure === "deadline") vi.useFakeTimers();
    try {
      const result = deployPipelineByRelayer({ graph, nodes });
      if (failure === "deadline") await vi.advanceTimersByTimeAsync(31_000);
      expect(await result).toMatchObject({
        failureCode: "FINALITY_UNKNOWN",
        txHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(clearPending).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  },
);
