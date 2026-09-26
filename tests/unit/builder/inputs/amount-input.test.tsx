import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { AmountInput } from "@/components/builder/inputs/amount-input";
import type { Asset } from "@/lib/flows/schema";

const USDC: Asset = { kind: "known", symbol: "USDC" };
const XLM: Asset = { kind: "native" };

function describedText(el: HTMLElement): string {
  return (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" | ");
}

// Owns the value the way a panel does, so each commit is echoed back.
function Owned({
  initial = "",
  spy,
  ...props
}: { initial?: string; spy: (s: string) => void } & Partial<
  React.ComponentProps<typeof AmountInput>
>) {
  const [value, setValue] = useState(initial);
  return (
    <AmountInput
      label="Quote amount"
      asset={USDC}
      {...props}
      value={value}
      onChange={(s) => {
        spy(s);
        setValue(s);
      }}
    />
  );
}

const field = () => screen.getByRole("textbox", { name: "Quote amount" }) as HTMLInputElement;

describe("AmountInput", () => {
  it("commits 1.5 as 15000000 stroops and keeps showing 1.5", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const { container } = render(<Owned spy={spy} />);
    await user.type(field(), "1.5");
    expect(field().value).toBe("1.5");
    expect(spy.mock.calls).toEqual([["10000000"], ["15000000"]]);
    expect(describedText(field())).toBe("= 1.5 USDC");
    expect(field().getAttribute("inputmode")).toBe("decimal");
    expect(field().type).toBe("text");
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("leaves the echo out with echo={false}", async () => {
    const user = userEvent.setup();
    render(<Owned spy={vi.fn()} echo={false} />);
    await user.type(field(), "1.5");
    expect(describedText(field())).not.toContain("= 1.5 USDC");
  });

  it("takes 0.5 character by character", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} />);
    await user.type(field(), "0.5");
    expect(field().value).toBe("0.5");
    expect(spy).toHaveBeenLastCalledWith("5000000");
  });

  it("clears to empty and commits nothing, then says what the flow still holds", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const { container } = render(<Owned initial="15000000" spy={spy} />);
    await user.clear(field());
    expect(field().value).toBe("");
    await user.tab();
    expect(field().value).toBe("");
    expect(spy).not.toHaveBeenCalled();
    expect(describedText(field())).toContain("Empty — the flow still uses 1.5 USDC.");
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("lets the caller word the empty note, for an amount the flow never holds", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(
      <Owned
        initial="15000000"
        spy={spy}
        emptyNote={(described) => `Empty — the preview still quotes ${described}.`}
      />,
    );
    await user.clear(field());
    await user.tab();
    expect(spy).not.toHaveBeenCalled();
    expect(describedText(field())).toContain("Empty — the preview still quotes 1.5 USDC.");
    expect(describedText(field())).not.toContain("the flow still uses");
  });

  it("refuses an 8th decimal and says why", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} />);
    await user.type(field(), "0.00000019");
    expect(field().value).toBe("0.0000001");
    expect(spy).toHaveBeenLastCalledWith("1");
    expect(describedText(field())).toContain("At most 7 decimal places.");
  });

  it.each(["1,5", "1e7"])("refuses a pasted %j rather than guessing", async (text) => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const { container } = render(<Owned spy={spy} />);
    await user.click(field());
    await user.paste(text);
    expect(field().value).toBe("");
    expect(spy).not.toHaveBeenCalled();
    expect(describedText(field())).toContain("Use digits and one decimal point, like 1.5.");
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("clamps a value above max on blur and says so", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} max="1000000000" />);
    await user.type(field(), "250");
    // 2 and 25 are in range and commit; 250 is held until blur.
    expect(spy.mock.calls).toEqual([["20000000"], ["250000000"]]);
    await user.tab();
    expect(spy).toHaveBeenLastCalledWith("1000000000");
    expect(field().value).toBe("100");
    expect(describedText(field())).toContain("Lowered to the maximum, 100 USDC.");
  });

  it("never commits 0 without a min: the floor is 1 stroop", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} />);
    await user.type(field(), "0");
    expect(spy).not.toHaveBeenCalled();
    await user.tab();
    expect(spy).toHaveBeenLastCalledWith("1");
    expect(field().value).toBe("0.0000001");
    expect(describedText(field())).toContain("Raised to the minimum, 0.0000001 USDC.");
  });

  it("normalises the draft on blur without a note when the value is unchanged", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} />);
    await user.type(field(), "007.50");
    await user.tab();
    expect(field().value).toBe("7.5");
    expect(describedText(field())).toBe("= 7.5 USDC");
  });

  it("follows a value changed from outside (undo, AI edit, flow load)", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <AmountInput label="Quote amount" asset={USDC} value="15000000" onChange={onChange} />,
    );
    expect(field().value).toBe("1.5");
    rerender(
      <AmountInput label="Quote amount" asset={USDC} value="20000000" onChange={onChange} />,
    );
    expect(field().value).toBe("2");
    rerender(<AmountInput label="Quote amount" asset={USDC} value="" onChange={onChange} />);
    expect(field().value).toBe("");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not call onChange when the parsed value is unchanged", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AmountInput label="Quote amount" asset={USDC} value="15000000" onChange={onChange} />);
    await user.type(field(), "0");
    expect(field().value).toBe("1.50");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("wires a caller's error as the field's error", async () => {
    const { container } = render(
      <AmountInput
        label="Quote amount"
        asset={USDC}
        value="0"
        onChange={() => {}}
        error="Enter an amount above zero."
      />,
    );
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(describedText(field())).toBe("= 0 USDC | Enter an amount above zero.");
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("works as a pay node's amount (a non-swap props shape)", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const { container } = render(
      <Owned spy={spy} label="Amount" asset={XLM} min="1" hint="Sent on every run." />,
    );
    const input = screen.getByRole("textbox", { name: "Amount" }) as HTMLInputElement;
    await user.type(input, "0");
    expect(spy).not.toHaveBeenCalled(); // below min: held, not committed
    await user.tab();
    expect(spy).toHaveBeenLastCalledWith("1");
    expect(input.value).toBe("0.0000001");
    expect(describedText(input)).toBe(
      "Sent on every run. = 0.0000001 XLM | Raised to the minimum, 0.0000001 XLM.",
    );
    expect(screen.getByText("XLM").getAttribute("aria-hidden")).toBe("true");
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
