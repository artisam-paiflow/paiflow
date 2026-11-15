import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ docked: false, legacy: vi.fn() }));
vi.mock("@/lib/hooks/use-media-query", () => ({
  NARROW_VIEWPORT_QUERY: "(max-width: 767px)",
  useMediaQuery: () => mocks.docked,
}));
// The guide requires extracted controls, never ConfigPanel itself.
vi.mock("@/components/builder/config-panel", () => ({
  default: (props: unknown) => {
    mocks.legacy(props);
    return null;
  },
}));
import CanvasConfigPanel from "@/components/builder/canvas-config-panel";
import { ConditionalCanvasSchema } from "@/lib/flows/conditional-canvas-schema";
import { ALL_FEATURES_ON } from "@/lib/feature-flags";
const graph = ConditionalCanvasSchema.parse({
  generation: "conditional-v2",
  conditionalPolicies: {
    version: 2,
    nodes: [],
    condition: { nodeId: "c", thresholdMode: "mutable" },
  },
  nodes: [{ id: "c", type: "condition", config: { kind: "amount_lt", amountStroops: "0" } }],
  edges: [],
});
const props = () => ({
  selectedId: "c",
  node: graph.nodes[0]!,
  graph,
  errors: [],
  onChange: vi.fn(),
  onPolicyChange: vi.fn(),
  onThresholdModeChange: vi.fn(),
  executionAvailable: false,
  onDelete: vi.fn(),
  addressBook: [],
  refreshAddressBook: vi.fn(),
  onClose: vi.fn(),
  focusOnOpen: true,
  network: "testnet" as const,
  features: ALL_FEATURES_ON,
});
beforeEach(() => {
  mocks.docked = false;
  vi.clearAllMocks();
});
afterEach(cleanup);
it("keyboard-open settings focus the existing heading and expose only amount/threshold controls", () => {
  render(<CanvasConfigPanel {...props()} />);
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Condition settings" }));
  expect(
    (screen.getByRole("combobox", { name: "Threshold mode" }) as HTMLSelectElement).value,
  ).toBe("mutable");
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it("Escape and Close return control through the existing panel callback", () => {
  const p = props();
  render(<CanvasConfigPanel {...p} />);
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Threshold mode" }), { key: "Escape" });
  expect(p.onClose).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Close Condition settings" }));
  expect(p.onClose).toHaveBeenCalledTimes(2);
});
it("threshold edits propagate the original condition identity", () => {
  const p = props();
  render(<CanvasConfigPanel {...p} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Threshold mode" }), {
    target: { value: "constant" },
  });
  expect(p.onThresholdModeChange).toHaveBeenCalledWith("c", "constant");
});
it("mobile conditional settings keep the existing portalled bottom sheet and heading focus", () => {
  mocks.docked = true;
  render(<CanvasConfigPanel {...props()} />);
  const panel = screen.getByTestId("config-panel-container");
  expect(panel.parentElement).toBe(document.body);
  expect(panel.className).toContain("bottom-0");
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Condition settings" }));
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it("the builder defaults to refusing conditional authoring without the ordinary-flow capability", async () => {
  const { default: BuilderClient } = await import("@/components/builder/builder-client");
  render(
    <BuilderClient
      flowId="flow"
      initialName="Retained conditional"
      initialGraph={graph}
      features={ALL_FEATURES_ON}
      network="testnet"
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain("original draft is retained");
  expect(screen.queryByRole("button", { name: /Use conditional reusable/ })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Threshold mode" })).toBeNull();
  expect(mocks.legacy).not.toHaveBeenCalled();
});
