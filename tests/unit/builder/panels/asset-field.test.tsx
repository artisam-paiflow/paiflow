import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { AssetField } from "@/components/builder/panels/asset-fields";
import { fieldErrorUnder, nodeIssues } from "@/lib/flows/issue-paths";
import type { Asset, FlowGraph, FlowNode } from "@/lib/flows/schema";
import { computeAssetFlow, validateFlow } from "@/lib/flows/validate";

const RECIPIENT = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const XLM: Asset = { kind: "native" };
const USDC: Asset = { kind: "known", symbol: "USDC" };

/** An action set to USDC behind a trigger that receives XLM: a mismatch. */
const MISMATCHED: Record<"pay" | "split" | "yield", FlowNode> = {
  pay: {
    id: "a",
    type: "pay",
    config: {
      recipient: RECIPIENT,
      asset: USDC,
      mode: "fixed",
      amountStroops: "1000000",
      fullAmount: true,
    },
  } as FlowNode,
  split: {
    id: "a",
    type: "split",
    config: {
      asset: USDC,
      recipients: [{ address: RECIPIENT, mode: "percentage", bps: 10_000 }],
    },
  } as FlowNode,
  yield: {
    id: "a",
    type: "yield",
    config: { asset: USDC, vault: RECIPIENT },
  } as FlowNode,
};

// web2_webhook, not on_receive: a yield may only follow a webhook-style trigger,
// and one trigger keeps the three cases on the same graph.
function graphWith(action: FlowNode): FlowGraph {
  return {
    nodes: [{ id: "t", type: "web2_webhook", config: { asset: XLM } } as FlowNode, action],
    edges: [{ id: "e1", source: "t", target: action.id }],
  } as FlowGraph;
}

/** The chain ConfigPanel runs: validateFlow → nodeIssues → fieldErrorUnder. */
function assetErrorFor(graph: FlowGraph, nodeId: string): string | null {
  const result = validateFlow(graph);
  const errors = result.ok ? [] : result.errors;
  const index = graph.nodes.findIndex((n) => n.id === nodeId);
  return fieldErrorUnder(nodeIssues(errors, nodeId, index).field, "asset");
}

async function expectNoAxeViolations(container: HTMLElement) {
  const { violations } = await axe.run(container, {
    rules: { region: { enabled: false } },
  });
  expect(violations.map((v) => v.id)).toEqual([]);
}

describe("AssetField shows the node's asset error (#407)", () => {
  it.each(["pay", "split", "yield"] as const)(
    "%s: validateFlow's mismatch reaches the select and describes it",
    async (type) => {
      const action = MISMATCHED[type];
      const graph = graphWith(action);
      const result = validateFlow(graph);
      expect(result.ok).toBe(false);
      // The path the panel reads: config.asset on this node's id.
      expect(result.ok ? [] : result.errors.map((e) => e.path)).toContain("nodes.a.config.asset");

      const error = assetErrorFor(graph, "a");
      expect(error).toMatch(/Asset mismatch: XLM flows into this step/);

      const { container } = render(
        <AssetField
          asset={USDC}
          onChange={() => {}}
          expectedAsset={computeAssetFlow(graph).get("a") ?? null}
          error={error}
        />,
      );
      const select = screen.getByRole("combobox", { name: "Asset" });
      expect(select.getAttribute("aria-invalid")).toBe("true");
      const describedBy = select.getAttribute("aria-describedby") ?? "";
      const described = describedBy
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      expect(described).toContain("Asset mismatch");
      // The message is shown, not only announced.
      expect(screen.getByText(/Asset mismatch/).className).not.toContain("sr-only");
      await expectNoAxeViolations(container);
    },
  );

  it("a matching asset produces no error and leaves the select valid", () => {
    const graph = graphWith({
      ...MISMATCHED.pay,
      config: { ...MISMATCHED.pay.config, asset: XLM },
    } as FlowNode);
    // The fixture is otherwise valid, so the mismatch check did run.
    expect(validateFlow(graph).ok).toBe(true);
    expect(assetErrorFor(graph, "a")).toBeNull();

    const { container } = render(<AssetField asset={XLM} onChange={() => {}} error={null} />);
    const select = screen.getByRole("combobox", { name: "Asset" });
    expect(select.getAttribute("aria-invalid")).toBeNull();
    expect(select.getAttribute("aria-describedby")).toBeNull();
    // The label names the control by id, and the error region is mounted
    // (empty, polite) before any error, so one that appears is announced.
    expect(container.querySelector("label")?.getAttribute("for")).toBe(select.id);
    const region = container.querySelector('p[aria-live="polite"]');
    expect(region?.textContent).toBe("");
    expect(region?.id).toMatch(/-error$/);
  });

  it("a Zod issue on a custom asset's code or issuer lands on the asset field", () => {
    const graph = {
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: { asset: { kind: "custom", code: "!!!", issuer: "not-an-issuer" } },
        },
        MISMATCHED.pay,
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    };
    const result = validateFlow(graph);
    expect(result.ok).toBe(false);
    const paths = result.ok ? [] : result.errors.map((e) => e.path);
    expect(paths.some((p) => p.startsWith("nodes.0.config.asset."))).toBe(true);

    const errors = result.ok ? [] : result.errors;
    const error = fieldErrorUnder(nodeIssues(errors, "t", 0).field, "asset");
    expect(error).not.toBeNull();

    render(<AssetField asset={XLM} onChange={() => {}} error={error} />);
    const select = screen.getByRole("combobox", { name: "Asset" });
    expect(select.getAttribute("aria-invalid")).toBe("true");
  });

  it("the read-only custom asset readout carries the error too", async () => {
    const custom: Asset = { kind: "custom", code: "EURC", issuer: RECIPIENT };
    const { container } = render(
      <AssetField asset={custom} onChange={() => {}} expectedAsset={custom} error="Bad asset" />,
    );
    const readout = container.querySelector("output");
    expect(readout?.getAttribute("aria-invalid")).toBe("true");
    const id = readout?.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(id)?.textContent).toBe("Bad asset");
    await expectNoAxeViolations(container);
  });
});
