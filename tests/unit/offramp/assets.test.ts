import { describe, expect, it, vi } from "vitest";
import { offRampAssetCode, resolveCashOutAsset } from "@/lib/offramp/assets";
import type { FlowGraph } from "@/lib/flows/schema";

vi.mock("@/lib/env", () => ({
  env: vi.fn(() => ({
    OFFRAMP_ASSET_CODE: "USDC",
    OFFRAMP_NETWORK: "XLM_USDC_T_CEKS",
    OFFRAMP_CHANNEL: "InstaPay",
  })),
}));

describe("offRampAssetCode", () => {
  it("returns XLM for native asset", () => {
    expect(offRampAssetCode({ kind: "native" })).toBe("XLM");
  });

  it("returns USDC for known USDC asset", () => {
    expect(offRampAssetCode({ kind: "known", symbol: "USDC" })).toBe("USDC");
  });

  it("returns env override for custom assets", () => {
    expect(offRampAssetCode({ kind: "custom", code: "FOO", issuer: "GBAR" })).toBe("USDC");
  });
});

describe("resolveCashOutAsset", () => {
  const USDC = { kind: "known", symbol: "USDC" } as const;

  function graph(
    nodes: Array<Record<string, unknown>>,
    edges: Array<{ source: string; target: string }> = [],
  ): FlowGraph {
    return { nodes, edges } as unknown as FlowGraph;
  }

  it("resolves the asset from an explicit cash_out graph node via edges", () => {
    const g = graph(
      [
        { id: "split", type: "split", config: { asset: USDC, recipients: [] } },
        { id: "co", type: "cash_out", config: { asset: { kind: "native" } } },
      ],
      [{ source: "split", target: "co" }],
    );
    const pipeline = [
      { nodeId: "split", contractAddress: "CSPLIT", templateKind: "SPLITTER" },
      { nodeId: "co", contractAddress: "CCO", templateKind: "CASH_OUT" },
    ];
    expect(resolveCashOutAsset(g, pipeline, "CSPLIT")).toEqual({ kind: "native" });
  });

  it("resolves the asset from the parent split node for a synthesized cash-out terminal", () => {
    // Synthesized terminals exist only in the pipeline snapshot — the saved
    // graph has no cash_out node and no edge from the split node.
    const g = graph([
      { id: "sub-1", type: "subscription", config: { asset: USDC } },
      { id: "split-1", type: "split", config: { asset: USDC, recipients: [] } },
    ]);
    const pipeline = [
      { nodeId: "sub-1", contractAddress: "CSUB", templateKind: "SUBSCRIPTION" },
      { nodeId: "split-1", contractAddress: "CSPLIT", templateKind: "SPLITTER" },
      { nodeId: "split-1-cashout-0", contractAddress: "CCO", templateKind: "CASH_OUT" },
    ];
    expect(resolveCashOutAsset(g, pipeline, "CSPLIT")).toEqual(USDC);
  });

  it("resolves the asset from the parent pay node for a synthesized cash-out terminal", () => {
    const g = graph([{ id: "pay-1", type: "pay", config: { asset: USDC } }]);
    const pipeline = [
      { nodeId: "pay-1", contractAddress: "CPAYER", templateKind: "PAYER" },
      { nodeId: "pay-1-cashout-0", contractAddress: "CCO", templateKind: "CASH_OUT_DEV" },
    ];
    expect(resolveCashOutAsset(g, pipeline, "CPAYER")).toEqual(USDC);
  });

  it("returns null when the source has no cash-out terminal at all", () => {
    const g = graph([{ id: "split-1", type: "split", config: { asset: USDC, recipients: [] } }]);
    const pipeline = [{ nodeId: "split-1", contractAddress: "CSPLIT", templateKind: "SPLITTER" }];
    expect(resolveCashOutAsset(g, pipeline, "CSPLIT")).toBeNull();
  });
});
