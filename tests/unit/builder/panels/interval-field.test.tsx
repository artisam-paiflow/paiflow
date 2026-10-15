import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { IntervalField } from "@/components/builder/panels/interval-field";

function describedText(el: HTMLElement) {
  return (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

describe("IntervalField", () => {
  it("names both controls independently and associates each error with its control", async () => {
    const { container } = render(
      <IntervalField
        amount={1}
        unit="day"
        amountError="Too many intervals"
        unitError="Invalid unit"
        onAmountChange={() => {}}
        onUnitChange={() => {}}
      />,
    );
    const group = screen.getByRole("group", { name: "Interval" });
    const number = within(group).getByRole("spinbutton", { name: "Number" });
    const unit = within(group).getByRole("combobox", { name: "Unit" });
    expect(number.getAttribute("aria-invalid")).toBe("true");
    expect(unit.getAttribute("aria-invalid")).toBe("true");
    expect(describedText(number)).toBe("Too many intervals");
    expect(describedText(unit)).toBe("Invalid unit");
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("supports keyboard focus and preserves number normalization and unit changes", async () => {
    const onAmountChange = vi.fn();
    const onUnitChange = vi.fn();
    render(
      <IntervalField
        amount={2}
        unit="day"
        onAmountChange={onAmountChange}
        onUnitChange={onUnitChange}
      />,
    );
    const user = userEvent.setup();
    const number = screen.getByRole("spinbutton", { name: "Number" });
    const unit = screen.getByRole("combobox", { name: "Unit" });
    await user.tab();
    expect(document.activeElement).toBe(number);
    await user.tab();
    expect(document.activeElement).toBe(unit);
    fireEvent.change(number, { target: { value: "2.9" } });
    expect(onAmountChange).toHaveBeenLastCalledWith(2);
    fireEvent.change(number, { target: { value: "0" } });
    expect(onAmountChange).toHaveBeenLastCalledWith(1);
    await user.selectOptions(unit, "week");
    expect(onUnitChange).toHaveBeenLastCalledWith("week");
  });
});
