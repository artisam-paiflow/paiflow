import { beforeEach, expect, it, vi } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { assetContractId } from "@/lib/stellar/assets";
const { balance } = vi.hoisted(() => ({ balance: vi.fn(async () => 123n) }));
vi.mock("@/lib/stellar/balance", () => ({ createTokenBalanceReader: vi.fn(() => balance) }));
import { createTokenBalanceReader } from "@/lib/stellar/balance";
import { getWorkflowBalances } from "@/lib/stellar/balances";

beforeEach(() => {
  vi.clearAllMocks();
  balance.mockReset().mockResolvedValue(123n);
});

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
  });
  expect(createTokenBalanceReader).toHaveBeenCalledWith("wallet");
  expect(graph.nodes[3]?.type).toBe("return_to_owner");
});

function simpleDeployment(): Parameters<typeof getWorkflowBalances>[0] {
  return {
    id: "d",
    sourceAccount: "wallet",
    contractAddress: StrKey.encodeContract(Buffer.alloc(32, 9)),
    graphSnapshot: {
      nodes: [{ id: "p", type: "pay", config: { asset: { kind: "native" }, recipient: "wallet" } }],
      edges: [],
    },
    pipelineSnapshot: [],
    flow: { templateKind: "PAYER" },
  };
}

it("retains the primary contract fallback after narrowing the deployment input", async () => {
  const result = await getWorkflowBalances(simpleDeployment());
  expect(result.nodes[0]).toMatchObject({
    nodeId: "primary",
    templateKind: "PAYER",
    balanceStroops: "123",
  });
  expect(result.freshness.totalsComplete).toBe(true);
});

it("keeps successful zero readings in freshness metadata", async () => {
  balance.mockResolvedValue(0n);
  const result = await getWorkflowBalances(simpleDeployment());
  expect(result.totals).toEqual([]);
  expect(result.nodes).toEqual([]);
  expect(result.freshness.targets[0]).toMatchObject({ balanceStroops: "0", stale: false });
  expect(result.freshness.targets[0]?.readAt).toEqual(expect.any(String));
});

it("marks mixed reads as partial and keeps failed targets out of totals", async () => {
  const deployment = simpleDeployment();
  deployment.pipelineSnapshot = [
    {
      nodeId: "s",
      templateKind: "SPLITTER",
      contractAddress: StrKey.encodeContract(Buffer.alloc(32, 8)),
    },
  ];
  balance.mockResolvedValueOnce(123n).mockRejectedValueOnce(new Error("offline"));
  const result = await getWorkflowBalances(deployment);
  expect(createTokenBalanceReader).toHaveBeenCalledTimes(1);
  expect(result.totals[0]?.balanceStroops).toBe("123");
  expect(result.freshness).toMatchObject({ status: "partial", totalsComplete: false });
  expect(result.freshness.targets[1]).toMatchObject({
    balanceStroops: null,
    readAt: null,
    stale: true,
    error: "offline",
  });
  expect(result.nodes[1]).toHaveProperty("error", "offline");
});

it("does no source-account lookup when there are no balance targets or no graph", async () => {
  const deployment = simpleDeployment();
  deployment.contractAddress = null;
  expect((await getWorkflowBalances(deployment)).freshness.targets).toEqual([]);
  deployment.graphSnapshot = null;
  expect(await getWorkflowBalances(deployment)).toMatchObject({
    totals: [],
    freshness: { status: "stale", totalsComplete: false },
  });
  expect(createTokenBalanceReader).not.toHaveBeenCalled();
});

it("unresolved assets are errors instead of a fresh complete empty total", async () => {
  const deployment = simpleDeployment();
  deployment.graphSnapshot = { nodes: [], edges: [] };
  deployment.pipelineSnapshot = [
    { nodeId: "p", templateKind: "PAYER", contractAddress: deployment.contractAddress! },
  ];
  const result = await getWorkflowBalances(deployment);
  expect(result.nodes).toHaveLength(1);
  expect(result.nodes[0]).toHaveProperty("error");
  expect(result.freshness).toMatchObject({ status: "stale", totalsComplete: false });
  expect(result.freshness.targets[0]?.readAt).toBeNull();
  expect(createTokenBalanceReader).not.toHaveBeenCalled();
});

it("waits for both active target reads on abort and never starts remaining targets", async () => {
  const deployment = simpleDeployment();
  deployment.pipelineSnapshot = Array.from({ length: 8 }, (_, index) => ({
    nodeId: `p${index}`,
    contractAddress: StrKey.encodeContract(Buffer.alloc(32, index + 1)),
    templateKind: "PAYER",
  }));
  deployment.contractAddress = null;
  const finishes: Array<() => void> = [];
  balance.mockImplementation(
    () => new Promise<bigint>((resolve) => finishes.push(() => resolve(1n))),
  );
  const controller = new AbortController();
  let settled = false;
  const read = getWorkflowBalances(deployment, controller.signal).finally(() => {
    settled = true;
  });
  const rejected = expect(read).rejects.toThrow("timed out");
  await Promise.resolve();
  expect(finishes).toHaveLength(2);
  controller.abort();
  finishes[0]!();
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(false);
  finishes[1]!();
  await rejected;
  expect(balance).toHaveBeenCalledTimes(2);
});
