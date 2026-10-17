import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PercentageInput } from "@/components/builder/inputs/percentage-input";

function Owned({ spy }: { spy: (percentage: number | undefined) => void }) {
  const [value, setValue] = useState<number | undefined>(25);
  return (
    <PercentageInput
      label="Percentage"
      value={value}
      onChange={(v) => {
        spy(v);
        setValue(v);
      }}
    />
  );
}

describe("Pay percentage input", () => {
  it("clears to unset and retains the existing percentage precision", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} />);
    const input = screen.getByRole("spinbutton", { name: "Percentage" }) as HTMLInputElement;
    await user.clear(input);
    expect(spy).toHaveBeenLastCalledWith(undefined);
    await user.tab();
    expect(input.value).toBe("");
    await user.type(input, "12.3456");
    expect(spy).toHaveBeenLastCalledWith(12.3456);
  });

  it("keeps the existing 0–100 clamp and connects validation errors", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const { rerender } = render(<Owned spy={spy} />);
    const input = screen.getByRole("spinbutton", { name: "Percentage" });
    await user.clear(input);
    await user.type(input, "101");
    expect(spy).toHaveBeenLastCalledWith(100);
    rerender(
      <PercentageInput
        label="Percentage"
        value={undefined}
        onChange={spy}
        error="Enter a percentage"
      />,
    );
    const invalidInput = screen.getByRole("spinbutton", { name: "Percentage" });
    const errorId = invalidInput.getAttribute("aria-describedby")!;
    expect(invalidInput.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(errorId)?.textContent).toBe("Enter a percentage");
  });
});
