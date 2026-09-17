/**
 * A tester saw "Received 10 USDC" under "Swapped 10 XLM -> 1.0578 USDC" on a
 * swap flow. Most inbound contract events publish only the sender and the
 * amount -- the asset stays in instance storage -- so the label has to come from
 * the graph, and the old resolver reached for the first action node's asset,
 * which on a swap is `assetOut`. These cases pin the inbound rule: the asset
 * entering a node is `assetIn` before `asset`, and the asset entering the flow
 * is the trigger's, in flow order rather than node-array order.
 */
import { describe, expect, it } from "vitest";
import type { FlowGraph, FlowNode } from "@/lib/flows/schema";
import {
  flowInboundAsset,
  inboundAsset,
  inboundAssetForContract,
  resolveEmittingNode,
  type PipelineNodeSnapshot,
} from "@/lib/flows/event-assets";

const RECIPIENT = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const TRIGGER_ADDR = "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD";
const SWAP_ADDR = "CCBX3NZTCQLQFSPG7HBOKL4P2RVPOPVFHDNRTOSCCJWBTPL2GHEH7RQS";
const PAY_ADDR = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const UNKNOWN_ADDR = "CDEEJZG6DYN65DTZLS6WU7YJ3I4RJ4TSOHF5VXEFO7PTTHWRNREPDOOU";

const XLM = { kind: "native" } as const;
const USDC = { kind: "known", symbol: "USDC" } as const;

const onReceive = { id: "t", type: "on_receive", config: { asset: XLM } };
const onSchedule = {
  id: "t",
  type: "on_schedule",
  config: { intervalAmount: 1, intervalUnit: "day", startsAt: "2026-01-01T00:00:00.000Z" },
};
const swap = {
  id: "s",
  type: "swap",
  config: { assetIn: XLM, assetOut: USDC, slippageBps: 100, deadlineSecs: 300 },
};
const pay = {
  id: "p",
  type: "pay",
  config: {
    recipient: RECIPIENT,
    asset: USDC,
    mode: "fixed",
    amountStroops: "1",
    fullAmount: false,
  },
};

function graph(nodes: unknown[], edges: { source: string; target: string }[]): FlowGraph {
  return { nodes, edges } as unknown as FlowGraph;
}

/** trigger(XLM) -> swap(XLM->USDC) -> pay(USDC): the flow from the bug report. */
const swapFlow = graph(
  [onReceive, swap, pay],
  [
    { source: "t", target: "s" },
    { source: "s", target: "p" },
  ],
);

const pipeline: PipelineNodeSnapshot[] = [
  { nodeId: "t", contractAddress: TRIGGER_ADDR, templateKind: "DEPOSIT_TRIGGER" },
  { nodeId: "s", contractAddress: SWAP_ADDR, templateKind: "SWAPPER" },
  { nodeId: "p", contractAddress: PAY_ADDR, templateKind: "PAYER" },
];

describe("inboundAsset", () => {
  it("reads a swap's assetIn, never its assetOut", () => {
    expect(inboundAsset(swap as unknown as FlowNode)).toEqual(XLM);
  });

  it("reads a plain action's or trigger's asset", () => {
    expect(inboundAsset(pay as unknown as FlowNode)).toEqual(USDC);
    expect(inboundAsset(onReceive as unknown as FlowNode)).toEqual(XLM);
  });

  it("is undefined for a node with no asset and for no node at all", () => {
    expect(inboundAsset(onSchedule as unknown as FlowNode)).toBeUndefined();
    expect(inboundAsset(undefined)).toBeUndefined();
  });
});

describe("flowInboundAsset", () => {
  it("answers with the trigger's asset, not the swap's output", () => {
    expect(flowInboundAsset(swapFlow)).toEqual(XLM);
  });

  it("walks flow order, not node-array order", () => {
    // `pay` is listed first but sits downstream of the swap; a `nodes.find`
    // would answer USDC.
    const reordered = graph(
      [pay, swap, onSchedule],
      [
        { source: "t", target: "s" },
        { source: "s", target: "p" },
      ],
    );
    expect(flowInboundAsset(reordered)).toEqual(XLM);
  });

  it("falls through a schedule trigger to the first action's inbound asset", () => {
    const scheduled = graph([onSchedule, swap], [{ source: "t", target: "s" }]);
    expect(flowInboundAsset(scheduled)).toEqual(XLM);
  });

  it("is undefined without a graph", () => {
    expect(flowInboundAsset(null)).toBeUndefined();
    expect(flowInboundAsset(undefined)).toBeUndefined();
  });
});

describe("resolveEmittingNode", () => {
  it("maps a contract address to its graph node", () => {
    expect(resolveEmittingNode({ graph: swapFlow, pipeline, contractAddress: SWAP_ADDR })?.id).toBe(
      "s",
    );
  });

  it("resolves the legacy synthetic 'trigger' nodeId to the graph's trigger", () => {
    const legacy: PipelineNodeSnapshot[] = [
      { nodeId: "trigger", contractAddress: TRIGGER_ADDR, templateKind: "DEPOSIT_TRIGGER" },
    ];
    expect(
      resolveEmittingNode({ graph: swapFlow, pipeline: legacy, contractAddress: TRIGGER_ADDR })?.id,
    ).toBe("t");
  });

  it("is undefined for an unknown address, a null pipeline and a null graph", () => {
    expect(
      resolveEmittingNode({ graph: swapFlow, pipeline, contractAddress: UNKNOWN_ADDR }),
    ).toBeUndefined();
    expect(
      resolveEmittingNode({ graph: swapFlow, pipeline: null, contractAddress: TRIGGER_ADDR }),
    ).toBeUndefined();
    expect(
      resolveEmittingNode({ graph: null, pipeline, contractAddress: TRIGGER_ADDR }),
    ).toBeUndefined();
  });
});

describe("inboundAssetForContract", () => {
  it("answers per contract: the trigger receives XLM and the payer receives USDC", () => {
    expect(
      inboundAssetForContract({ graph: swapFlow, pipeline, contractAddress: TRIGGER_ADDR }),
    ).toEqual(XLM);
    expect(
      inboundAssetForContract({ graph: swapFlow, pipeline, contractAddress: PAY_ADDR }),
    ).toEqual(USDC);
  });

  it("gives the swap node its assetIn, so its inbound leg is never labelled USDC", () => {
    expect(
      inboundAssetForContract({ graph: swapFlow, pipeline, contractAddress: SWAP_ADDR }),
    ).toEqual(XLM);
  });

  it("falls back to the flow's inbound asset when the emitter cannot be resolved", () => {
    expect(
      inboundAssetForContract({ graph: swapFlow, pipeline: null, contractAddress: TRIGGER_ADDR }),
    ).toEqual(XLM);
  });
});
