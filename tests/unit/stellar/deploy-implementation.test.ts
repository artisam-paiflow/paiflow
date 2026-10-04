import { Account, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import { beforeEach, expect, it, vi } from "vitest";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { flowToPipeline } from "@/lib/flows/to-params";

const { getAccount, simulate, assemble } = vi.hoisted(() => ({
  getAccount: vi.fn(),
  simulate: vi.fn(),
  assemble: vi.fn(),
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ getAccount, simulateTransaction: simulate }),
  horizon: () => ({}),
}));
vi.mock("@/lib/stellar/config", () => ({
  getFactoryAddress: async () => StrKey.encodeContract(Buffer.alloc(32, 1)),
}));
vi.mock("@stellar/stellar-sdk", async (original) => {
  const actual = await original<typeof import("@stellar/stellar-sdk")>();
  return { ...actual, rpc: { ...actual.rpc, assembleTransaction: assemble } };
});
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
