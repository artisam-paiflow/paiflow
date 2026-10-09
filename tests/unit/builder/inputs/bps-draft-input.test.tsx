import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { BpsDraftInput } from "@/components/builder/inputs/bps-draft-input";

function describedText(el: HTMLElement): string {
  return (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" | ");
}

// Owns the share the way the split panel does: each commit is stored and
// echoed back, inside the `<label>` the panel's `Field` renders.
function Owned({ initial = 2500, spy }: { initial?: number; spy: (bps: number) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label>
        <span>Share</span>
        <BpsDraftInput
          className="input"
          value={value}
          placeholder="0"
          onChange={(bps) => {
            spy(bps);
            setValue(bps);
          }}
        />
      </label>
      <output data-testid="stored">{value}</output>
      <button type="button">elsewhere</button>
    </>
  );
}

const field = () => screen.getByRole("textbox", { name: "Share" }) as HTMLInputElement;
const stored = () => Number(screen.getByTestId("stored").textContent);

describe("BpsDraftInput (#583)", () => {
  it("shows the stored share as a percent and is an accessible text field", async () => {
    const { container } = render(<Owned initial={1250} spy={vi.fn()} />);
    expect(field().value).toBe("12.5");
    expect(field().type).toBe("text");
    expect(field().getAttribute("inputmode")).toBe("decimal");
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("keeps a cleared field empty and never commits it", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} />);
    await user.clear(field());
    expect(field().value).toBe("");
    expect(spy).not.toHaveBeenCalled();
    expect(stored()).toBe(2500);
  });

  it("says the flow still uses the old share when a cleared field blurs", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} />);
    await user.clear(field());
    await user.tab();
    expect(field().value).toBe("");
    expect(describedText(field())).toMatch(/still uses 25%/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps 12. while typing, committing 1200 bps, then 12.5 as 1250", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} />);
    await user.clear(field());
    await user.type(field(), "12.");
    expect(field().value).toBe("12.");
    expect(stored()).toBe(1200);
    await user.type(field(), "5");
    expect(field().value).toBe("12.5");
    expect(spy.mock.calls).toEqual([[100], [1200], [1250]]);
    await user.tab();
    expect(field().value).toBe("12.5");
    expect(stored()).toBe(1250);
  });

  it("commits two decimals exactly: 33.33 is 3333 bps, 0.01 is 1", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} />);
    await user.clear(field());
    await user.type(field(), "33.33");
    expect(spy).toHaveBeenLastCalledWith(3333);
    await user.clear(field());
    await user.type(field(), "0.01");
    expect(spy).toHaveBeenLastCalledWith(1);
    expect(stored()).toBe(1);
  });

  it("refuses a third decimal instead of rounding it", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} />);
    await user.clear(field());
    await user.type(field(), "12.345");
    expect(field().value).toBe("12.34");
    expect(stored()).toBe(1234);
    expect(describedText(field())).toMatch(/At most 2 decimal places/);
  });

  it("commits a typed 0 as 0 bps, for validateFlow to report", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} />);
    await user.clear(field());
    await user.type(field(), "0");
    expect(field().value).toBe("0");
    expect(spy.mock.calls).toEqual([[0]]);
    expect(stored()).toBe(0);
  });

  it("types 0.5 through its zero without the draft resetting", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} />);
    await user.clear(field());
    await user.type(field(), "0.5");
    expect(field().value).toBe("0.5");
    expect(stored()).toBe(50);
  });

  it("commits 100 as 10000 bps", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} />);
    await user.clear(field());
    await user.type(field(), "100");
    expect(spy).toHaveBeenLastCalledWith(10_000);
    expect(stored()).toBe(10_000);
  });

  it("holds over 100% in the draft, then lowers it to 100% on blur with a note", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} />);
    await user.clear(field());
    await user.type(field(), "150");
    expect(field().value).toBe("150");
    // "1" and "15" commit on the way; "150" does not.
    expect(spy.mock.calls).toEqual([[100], [1500]]);
    await user.tab();
    expect(field().value).toBe("100");
    expect(stored()).toBe(10_000);
    expect(describedText(field())).toMatch(/Lowered to the maximum, 100%/);
  });

  it("refuses letters, signs and a comma with a note, leaving the share alone", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} />);
    for (const junk of ["a", "-", "e", ","]) {
      await user.type(field(), junk);
      expect(field().value).toBe("25");
    }
    expect(spy).not.toHaveBeenCalled();
    expect(describedText(field())).toMatch(/digits and one decimal point/);
  });

  it("takes a pasted share, and refuses a pasted 12,5 instead of committing 125", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} />);
    await user.clear(field());
    await user.paste("12.5");
    expect(field().value).toBe("12.5");
    expect(spy.mock.calls).toEqual([[1250]]);
    await user.clear(field());
    await user.paste("12,5");
    expect(field().value).toBe("");
    expect(spy.mock.calls).toEqual([[1250]]);
    expect(stored()).toBe(1250);
  });

  it("follows an outside change to the stored share", () => {
    const { rerender } = render(
      <BpsDraftInput aria-label="Share" value={2500} onChange={vi.fn()} />,
    );
    expect(field().value).toBe("25");
    rerender(<BpsDraftInput aria-label="Share" value={3333} onChange={vi.fn()} />);
    expect(field().value).toBe("33.33");
  });
});
