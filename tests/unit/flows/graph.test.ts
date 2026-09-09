/**
 * pipelineTopoOrder is what makes "the first contract action" mean the one the
 * trigger reaches first rather than the one added to the canvas first, so the
 * cases that matter are the ones where those two orders disagree.
 */
import { describe, expect, it } from "vitest";
import { inFlowOrder, pipelineTopoOrder } from "@/lib/flows/graph";
import type { FlowGraph, FlowNode } from "@/lib/flows/schema";

const ACCOUNT = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const XLM = { kind: "native" } as const;
const USDC = { kind: "known", symbol: "USDC" } as const;

const trigger = { id: "t", type: "on_receive", config: { asset: XLM } };
const swap = {
  id: "s",
  type: "swap",
  config: { assetIn: XLM, assetOut: USDC, slippageBps: 100, deadlineSecs: 300 },
};
const pay = {
  id: "p",
  type: "pay",
  config: {
    recipient: ACCOUNT,
    asset: USDC,
    mode: "fixed",
    amountStroops: "1000000",
    fullAmount: true,
  },
};
const email = { id: "m", type: "email_notify", config: { to: "a@example.com" } };

const graph = (nodes: unknown[], edges: { source: string; target: string }[]): FlowGraph =>
  ({
    nodes,
    edges: edges.map((e, i) => ({ id: `e${i}`, ...e })),
  }) as FlowGraph;

describe("pipelineTopoOrder", () => {
  it("follows the edges, not the node array", () => {
    const g = graph(
      [trigger, pay, swap],
      [
        { source: "t", target: "s" },
        { source: "s", target: "p" },
      ],
    );
    expect(pipelineTopoOrder(g)).toEqual(["t", "s", "p"]);
  });

  it("releases a merge point only after every path into it", () => {
    const g = graph(
      [trigger, { ...pay, id: "a" }, { ...pay, id: "b" }, { ...pay, id: "merge" }],
      [
        { source: "t", target: "a" },
        { source: "t", target: "b" },
        { source: "a", target: "merge" },
        { source: "b", target: "merge" },
      ],
    );
    expect(pipelineTopoOrder(g)).toEqual(["t", "a", "b", "merge"]);
  });

  it("does not carry ordering through an email_notify node", () => {
    // The pipeline never wires email nodes as next steps, so a pay hanging off
    // one is not downstream of anything as far as the contracts are concerned.
    const g = graph(
      [trigger, email, pay],
      [
        { source: "t", target: "m" },
        { source: "m", target: "p" },
      ],
    );
    expect(pipelineTopoOrder(g)).toEqual(["t"]);
  });

  it("omits nodes unreachable from the trigger", () => {
    const g = graph([trigger, swap, pay], [{ source: "t", target: "s" }]);
    expect(pipelineTopoOrder(g)).toEqual(["t", "s"]);
  });

  it("terminates on a cycle instead of looping", () => {
    const g = graph(
      [trigger, swap, pay],
      [
        { source: "t", target: "s" },
        { source: "s", target: "p" },
        { source: "p", target: "s" },
      ],
    );
    expect(pipelineTopoOrder(g)).toEqual(["t"]);
  });

  it("returns nothing without a trigger", () => {
    expect(pipelineTopoOrder(graph([swap, pay], [{ source: "s", target: "p" }]))).toEqual([]);
  });
});

describe("inFlowOrder", () => {
  it("sorts by distance from the trigger, whatever order it is given", () => {
    const g = graph(
      [trigger, pay, swap],
      [
        { source: "t", target: "s" },
        { source: "s", target: "p" },
      ],
    );
    const actions = [pay, swap] as unknown as FlowNode[];
    expect(inFlowOrder(g, actions).map((n) => n.id)).toEqual(["s", "p"]);
  });

  it("keeps unreachable nodes rather than dropping them", () => {
    // Dropping one would quietly change how many actions validation counts.
    const orphan = { ...pay, id: "orphan" };
    const g = graph(
      [trigger, orphan, swap, pay],
      [
        { source: "t", target: "s" },
        { source: "s", target: "p" },
      ],
    );
    const actions = [orphan, pay, swap] as unknown as FlowNode[];
    expect(inFlowOrder(g, actions).map((n) => n.id)).toEqual(["s", "p", "orphan"]);
  });

  it("does not mutate the array it is given", () => {
    const g = graph(
      [trigger, pay, swap],
      [
        { source: "t", target: "s" },
        { source: "s", target: "p" },
      ],
    );
    const actions = [pay, swap] as unknown as FlowNode[];
    inFlowOrder(g, actions);
    expect(actions.map((n) => n.id)).toEqual(["p", "s"]);
  });
});
