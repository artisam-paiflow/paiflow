import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import axe from "axe-core";
import {
  ConditionalConditionSettings,
  ConditionalGenerationControl,
  ConditionalNotice,
} from "@/components/builder/conditional-settings";
import Palette from "@/components/builder/palette";
import { ALL_FEATURES_ON } from "@/lib/feature-flags";
import type { FlowNode } from "@/lib/flows/schema";
const node: Extract<FlowNode, { type: "condition" }> = {
  id: "condition",
  type: "condition",
  config: { kind: "amount_gt", amountStroops: "50" },
};
afterEach(cleanup);
const settings = (extra: Partial<Parameters<typeof ConditionalConditionSettings>[0]> = {}) =>
  render(
    <ConditionalConditionSettings
      node={node}
      thresholdMode="constant"
      onChange={vi.fn()}
      onModeChange={vi.fn()}
      available={false}
      {...extra}
    />,
  );
it("offers only strict amount comparisons and constant/default or admin-mutable threshold", () => {
  settings();
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
    "Amount is greater than",
    "Amount is less than",
    "Constant",
    "Admin mutable",
  ]);
  expect(
    (screen.getByRole("combobox", { name: "Threshold mode" }) as HTMLSelectElement).value,
  ).toBe("constant");
  expect(screen.getByText(/Equality always takes False/)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("Draft editing is available");
});
it("changes threshold mode through keyboard selection with no per-payment option", async () => {
  const onModeChange = vi.fn();
  settings({ onModeChange });
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Threshold mode" }),
    "mutable",
  );
  expect(onModeChange).toHaveBeenCalledWith("mutable");
  expect(screen.queryByRole("option", { name: /execution|per-payment/i })).toBeNull();
});
it("edits comparison while retaining the authored amount", async () => {
  const onChange = vi.fn();
  settings({ onChange });
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Amount comparison" }),
    "amount_lt",
  );
  expect(onChange).toHaveBeenCalledWith({
    ...node,
    config: { kind: "amount_lt", amountStroops: "50" },
  });
});
it("preserves immediate zero-on-clear shared amount behavior", () => {
  const onChange = vi.fn();
  settings({ onChange });
  const input = screen.getByRole("textbox", { name: "Threshold" });
  fireEvent.change(input, { target: { value: "" } });
  expect(onChange).toHaveBeenCalledWith({
    ...node,
    config: { kind: "amount_gt", amountStroops: "0" },
  });
});
it("shows exact i128 maximum through the shared non-floating amount input", () => {
  const max = ((1n << 127n) - 1n).toString();
  settings({ node: { ...node, config: { kind: "amount_gt", amountStroops: max } } });
  expect((screen.getByRole("textbox", { name: "Threshold" }) as HTMLInputElement).value).toBe(
    "17014118346046923173168730371588.4105727",
  );
});
it("keeps input controls accessible and does not add execution threshold authority", async () => {
  const { container } = settings();
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(result.violations).toEqual([]);
});
it("explains both-branch obligations and selected-only inputs without activating artifacts", () => {
  render(<ConditionalNotice available={false} />);
  expect(screen.getByText(/Only declared prefix and selected-branch/).textContent).toContain(
    "inactive branch",
  );
  expect(screen.getByText(/Each payment compares/).textContent).toContain("Equality follows False");
});
it("requires an explicit user action and disables opt-in while an original edit is pending", () => {
  const onEnable = vi.fn(),
    { rerender } = render(<ConditionalGenerationControl active={false} busy onEnable={onEnable} />);
  const button = screen.getByRole("button", {
    name: /Use conditional reusable/,
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(onEnable).not.toHaveBeenCalled();
  rerender(<ConditionalGenerationControl active={false} busy={false} onEnable={onEnable} />);
  fireEvent.click(screen.getByRole("button", { name: /Use conditional reusable/ }));
  expect(onEnable).toHaveBeenCalledTimes(1);
});
it("active generation has no downgrade switch and explains manual editing", () => {
  render(<ConditionalGenerationControl active busy={false} onEnable={vi.fn()} />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText(/AI editing and template creation are unavailable/)).toBeTruthy();
});
it("conditional palette offers only supported blocks and prevents another condition", () => {
  render(<Palette conditional features={ALL_FEATURES_ON} onAdd={vi.fn()} flowNodes={[node]} />);
  for (const label of ["On Schedule", "Subscription", "HTTP Webhook", "Swap", "Yield", "Hold"])
    expect(screen.queryByRole("button", { name: new RegExp(`^${label}$`) })).toBeNull();
  for (const label of ["Pay", "Split", "Return to owner"])
    expect(screen.getByRole("button", { name: new RegExp(label) })).toBeTruthy();
  expect((screen.getByRole("button", { name: /^Condition$/ }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});
it("default palette preserves immediate/template contexts without conditional restriction", () => {
  render(<Palette features={ALL_FEATURES_ON} onAdd={vi.fn()} flowNodes={[]} />);
  expect(screen.getByRole("button", { name: /Subscription/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /On Schedule/ })).toBeTruthy();
});
