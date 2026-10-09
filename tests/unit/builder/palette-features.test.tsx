import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Palette, { visibleTemplates } from "@/components/builder/palette";
import { ALL_FEATURES_ON } from "@/lib/feature-flags";

function renderPalette(features = ALL_FEATURES_ON) {
  render(<Palette onAdd={vi.fn()} flowNodes={[]} features={features} />);
}

describe("Palette under the surface switches (#722)", () => {
  it("offers Payroll while the switch is on", () => {
    renderPalette();
    expect(screen.getByRole("button", { name: /Payroll/ })).toBeTruthy();
  });

  it("drops Payroll when the server switches it off, keeping the other triggers", () => {
    renderPalette({ ...ALL_FEATURES_ON, payroll: false });
    expect(screen.queryByRole("button", { name: /Payroll/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Subscription/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /On Receive/ })).toBeTruthy();
  });

  it("never offers Cash Out, and the off-ramp switch removes nothing else", () => {
    const on = visibleTemplates(ALL_FEATURES_ON).map((t) => t.label);
    const off = visibleTemplates({ ...ALL_FEATURES_ON, offramp: false }).map((t) => t.label);
    expect(on).not.toContain("Cash Out");
    expect(off).toEqual(on);
  });
});
