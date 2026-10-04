import { beforeEach, expect, it, vi } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { assetContractId } from "@/lib/stellar/assets";
const { balance } = vi.hoisted(() => ({ balance: vi.fn(async () => 123n) }));
vi.mock("@/lib/stellar/balance", () => ({ fetchTokenBalance: balance }));
import { getWorkflowBalances } from "@/lib/stellar/balances";

beforeEach(() => vi.clearAllMocks());

it("reads a shared Streamer once, counts its funds once, and uses persisted block associations", async () => {
  const asset = { kind: "native" } as const;
  // The graph deliberately has different labels/types than the persisted bindings.
  // Monitoring must not recompile associations from a subsequently edited graph.
  const graph = FlowGraphSchema.parse({
    nodes: [
      { id: "t", type: "on_receive", config: { asset } },
      {
        id: "p",
        type: "pay",
        config: {
          asset,
          recipient: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          amountStroops: "100",
          mode: "fixed",
        },
      },
    ],
    edges: [{ id: "tp", source: "t", target: "p" }],
  });
  const address = StrKey.encodeContract(Buffer.alloc(32, 3));
  const node = {
    nodeId: "p",
    templateKind: "STREAMER",
    contractAddress: address,
    implementation: {
      version: 1,
      bindings: [
        { blockId: "t", blockType: "on_schedule", role: "schedule" },
        { blockId: "p", blockType: "split", role: "distribution" },
      ],
    },
  };
  const result = await getWorkflowBalances({
    id: "d",
    sourceAccount: "wallet",
    graphSnapshot: graph,
    contractAddress: address,
    pipelineSnapshot: [node, { ...node, nodeId: "alias" }],
    flow: { templateKind: "STREAMER" },
  } as unknown as Deployment & { flow: { templateKind: "STREAMER" } });
  expect(balance).toHaveBeenCalledTimes(1);
  expect(result.nodes).toHaveLength(1);
  expect(result.nodes[0]?.implementationLabel).toBe("Schedule + Split");
  expect(result.totals).toEqual([{ asset, symbol: "XLM", balanceStroops: "123" }]);
});

it("reads preserved timelock and immutable Pay balances for a Return-only flow", async () => {
  const asset = { kind: "native" } as const;
  const graph = FlowGraphSchema.parse({
    nodes: [
      { id: "t", type: "on_receive", config: { asset } },
      { id: "c", type: "condition", config: { kind: "time_after", at: "2030-01-01T00:00:00Z" } },
      { id: "h", type: "hold", config: {} },
      { id: "r", type: "return_to_owner", config: {} },
    ],
    edges: [
      { id: "tc", source: "t", target: "c" },
      { id: "ch", source: "c", target: "h", sourceHandle: "false" },
      { id: "cr", source: "c", target: "r", sourceHandle: "true" },
    ],
  });
  const address = StrKey.encodeContract(Buffer.alloc(32, 1));
  const deployment = {
    id: "d",
    sourceAccount: "wallet",
    graphSnapshot: graph,
    contractAddress: null,
    pipelineSnapshot: [
      { nodeId: "c", templateKind: "TIMELOCK", contractAddress: address },
      {
        nodeId: "r",
        templateKind: "PAYER",
        contractAddress: StrKey.encodeContract(Buffer.alloc(32, 2)),
      },
    ],
    flow: { templateKind: "DEPOSIT_TRIGGER" },
  } as unknown as Deployment & { flow: { templateKind: "DEPOSIT_TRIGGER" } };
  const result = await getWorkflowBalances(deployment);
  expect(result.nodes.map((n) => n.nodeId)).toEqual(["c", "r"]);
  expect(result.totals).toEqual([{ asset, symbol: "XLM", balanceStroops: "246" }]);
  expect(balance).toHaveBeenCalledWith({
    tokenAddress: assetContractId(asset),
    holderAddress: address,
    sourceAccount: "wallet",
  });
  expect(graph.nodes[3]?.type).toBe("return_to_owner");
});
