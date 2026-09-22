import { describe, expect, it } from "vitest";
import { FlowGraphSchema, MIN_SWAP_SLIPPAGE_BPS, type Asset } from "@/lib/flows/schema";
import { swapConfigIssues, type SwapNode, type SwapRuleContext } from "@/lib/flows/swap-rules";
import { validateFlow } from "@/lib/flows/validate";

const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const RECIPIENT = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const XLM: Asset = { kind: "native" };
const USDC: Asset = { kind: "known", symbol: "USDC" };
const PHP: Asset = { kind: "custom", code: "PHP", issuer: ISSUER };
const PENDING_ISSUER: Asset = { kind: "custom", code: "PHP", issuer: "PENDING:issuer" };

function swap(config: Partial<SwapNode["config"]> = {}): SwapNode {
  return {
    id: "s",
    type: "swap",
    config: { assetIn: XLM, assetOut: USDC, slippageBps: 100, deadlineSecs: 300, ...config },
  };
}

const CTX: SwapRuleContext = { nextStepCount: 1, incomingAsset: XLM, triggerAsset: XLM };
const codes = (node: SwapNode, ctx: Partial<SwapRuleContext> = {}) =>
  swapConfigIssues(node, { ...CTX, ...ctx }).map((i) => [i.code, i.path]);

describe("swapConfigIssues", () => {
  it("passes a realistic XLM → USDC swap, and USDC → XLM", () => {
    expect(codes(swap())).toEqual([]);
    expect(codes(swap({ assetIn: USDC, assetOut: XLM }), { incomingAsset: USDC })).toEqual([]);
  });

  it("SWAP_SAME_ASSET on assetOut", () => {
    expect(codes(swap({ assetOut: XLM }))).toEqual([
      ["SWAP_SAME_ASSET", "nodes.s.config.assetOut"],
    ]);
  });

  it("SWAP_SLIPPAGE_TOO_LOW under the floor, and not at it", () => {
    for (const bps of [0, MIN_SWAP_SLIPPAGE_BPS - 1]) {
      expect(codes(swap({ slippageBps: bps }))).toEqual([
        ["SWAP_SLIPPAGE_TOO_LOW", "nodes.s.config.slippageBps"],
      ]);
    }
    expect(codes(swap({ slippageBps: MIN_SWAP_SLIPPAGE_BPS }))).toEqual([]);
  });

  it("SWAP_NEEDS_NEXT_STEP at zero and SWAP_SINGLE_EDGE past one, both node-level", () => {
    expect(codes(swap(), { nextStepCount: 0 })).toEqual([["SWAP_NEEDS_NEXT_STEP", "nodes.s"]]);
    expect(codes(swap(), { nextStepCount: 3 })).toEqual([["SWAP_SINGLE_EDGE", "nodes.s"]]);
  });

  it("SWAP_ASSET_NOT_SUPPORTED on either side, bound to that field", () => {
    expect(codes(swap({ assetOut: PHP }))).toEqual([
      ["SWAP_ASSET_NOT_SUPPORTED", "nodes.s.config.assetOut"],
    ]);
    expect(codes(swap({ assetIn: PHP }), { incomingAsset: XLM })).toEqual([
      ["SWAP_ASSET_NOT_SUPPORTED", "nodes.s.config.assetIn"],
    ]);
  });

  it("refuses a PENDING: issuer by the same rule", () => {
    expect(codes(swap({ assetOut: PENDING_ISSUER }))).toEqual([
      ["SWAP_ASSET_NOT_SUPPORTED", "nodes.s.config.assetOut"],
    ]);
  });

  it("names the trigger's asset when the unsupported asset arrives from it", () => {
    const [issue] = swapConfigIssues(swap({ assetIn: PHP }), {
      ...CTX,
      incomingAsset: PHP,
      triggerAsset: PHP,
    });
    expect(issue?.code).toBe("SWAP_ASSET_NOT_SUPPORTED");
    expect(issue?.friendlyMessage).toContain("receives PHP from the trigger");
    expect(issue?.friendlyMessage).toContain("Change the trigger's asset");
  });

  it("does not blame the trigger when the asset was picked on the swap", () => {
    const [issue] = swapConfigIssues(swap({ assetIn: PHP }), CTX);
    expect(issue?.friendlyMessage).not.toContain("trigger");
    expect(issue?.friendlyMessage).toContain('"Asset In"');
  });

  it("reports every rule a swap breaks, catalogue first", () => {
    expect(
      codes(swap({ assetIn: PHP, assetOut: PHP, slippageBps: 0 }), { nextStepCount: 2 }).map(
        ([code]) => code,
      ),
    ).toEqual([
      "SWAP_ASSET_NOT_SUPPORTED",
      "SWAP_ASSET_NOT_SUPPORTED",
      "SWAP_SAME_ASSET",
      "SWAP_SLIPPAGE_TOO_LOW",
      "SWAP_SINGLE_EDGE",
    ]);
  });

  it("tags every issue with its node and field", () => {
    for (const i of swapConfigIssues(swap({ assetOut: XLM, slippageBps: 0 }), CTX)) {
      expect(i.nodeId).toBe("s");
      expect(i.path).toBe(`nodes.s.config.${i.field}`);
    }
  });
});

function flow(trigger: Asset, swapConfig: Partial<SwapNode["config"]>) {
  return {
    nodes: [
      { id: "t", type: "on_receive", config: { asset: trigger } },
      swap(swapConfig),
      {
        id: "p",
        type: "pay",
        config: {
          recipient: RECIPIENT,
          asset: swapConfig.assetOut ?? USDC,
          mode: "fixed",
          amountStroops: "1000000",
          fullAmount: true,
        },
      },
    ],
    edges: [
      { id: "e1", source: "t", target: "s" },
      { id: "e2", source: "s", target: "p" },
    ],
  };
}

describe("validateFlow with swap rules", () => {
  it("a same-asset swap parses under the shape schema but is refused", () => {
    const g = flow(XLM, { assetOut: XLM });
    expect(FlowGraphSchema.safeParse(g).success).toBe(true);
    const r = validateFlow(g);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("SWAP_SAME_ASSET");
  });

  it("a custom asset from the trigger parses but is refused on assetIn, naming the trigger", () => {
    const g = flow(PHP, { assetIn: PHP });
    expect(FlowGraphSchema.safeParse(g).success).toBe(true);
    const r = validateFlow(g);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.path === "nodes.s.config.assetIn");
      expect(issue?.code).toBe("SWAP_ASSET_NOT_SUPPORTED");
      expect(issue?.friendlyMessage).toContain("from the trigger");
    }
  });

  it("a PENDING: issuer on a swap is a field error, not a throw", () => {
    const r = validateFlow(flow(XLM, { assetOut: PENDING_ISSUER }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.path === "nodes.s.config.assetOut")?.code).toBe(
        "SWAP_ASSET_NOT_SUPPORTED",
      );
    }
  });
});
