import { describe, expect, it } from "vitest";
import { validationErrorKey } from "@/lib/analytics/validation-tracking";

const types = new Map([
  ["n-swap", "swap"],
  ["n-split", "split"],
]);

describe("validationErrorKey", () => {
  it("replaces node ids with the node type", () => {
    expect(validationErrorKey("nodes.n-swap.config.slippageBps", types)).toEqual({
      key: "swap.config.slippageBps",
      nodeType: "swap",
    });
  });

  it("collapses array indices", () => {
    expect(validationErrorKey("nodes.n-split.config.recipients.2.amountStroops", types)).toEqual({
      key: "split.config.recipients.#.amountStroops",
      nodeType: "split",
    });
  });

  it("handles node-level, unknown-node, edge and graph-level paths", () => {
    expect(validationErrorKey("nodes.n-swap", types).key).toBe("swap");
    expect(validationErrorKey("nodes.gone.config.x", types)).toEqual({
      key: "node.config.x",
      nodeType: null,
    });
    expect(validationErrorKey("edges.e-123", types).key).toBe("edges");
    expect(validationErrorKey("nodes", types).key).toBe("nodes");
    expect(validationErrorKey("senderKyc", types).key).toBe("senderKyc");
  });

  it("keeps the swap rule keys stable, and groups the catalogue rule by its field", () => {
    expect(validationErrorKey("nodes.n-swap.config.assetOut", types).key).toBe(
      "swap.config.assetOut",
    );
    expect(validationErrorKey("nodes.n-swap.config.slippageBps", types).key).toBe(
      "swap.config.slippageBps",
    );
    expect(validationErrorKey("nodes.n-swap", types).key).toBe("swap");
    expect(validationErrorKey("nodes.n-swap.config.assetIn", types).key).toBe(
      "swap.config.assetIn",
    );
  });
});
