import { expect, it, vi } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { assetContractId } from "@/lib/stellar/assets";
const { balance } = vi.hoisted(() => ({ balance: vi.fn(async () => 123n) }));
vi.mock("@/lib/stellar/balance", () => ({ fetchTokenBalance: balance }));
import { getWorkflowBalances } from "@/lib/stellar/balances";

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
