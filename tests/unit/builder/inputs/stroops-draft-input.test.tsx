import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { StroopsDraftInput } from "@/components/builder/inputs/stroops-draft-input";
import { tokenAmountToStroops } from "@/lib/flows/schema";

function describedText(el: HTMLElement): string {
  return (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" | ");
}

// Owns the value the way a config panel does: each commit is stored and
// echoed back, inside the same `<label>` wrapper the panel's `Field` uses.
function Owned({ initial, spy }: { initial?: string; spy: (s: string) => void }) {
  const [value, setValue] = useState<string | undefined>(initial);
  return (
    <label>
      <span>Amount</span>
      <StroopsDraftInput
        className="input"
        value={value}
        onChange={(s) => {
          spy(s);
          setValue(s);
        }}
      />
    </label>
  );
}

const field = () => screen.getByRole("textbox") as HTMLInputElement;

describe("StroopsDraftInput (#615)", () => {
  it("types 1.5 as 15000000 stroops and keeps showing 1.5", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const { container } = render(<Owned spy={spy} />);
    await user.type(field(), "1.5");
    expect(field().value).toBe("1.5");
    expect(spy.mock.calls).toEqual([["10000000"], ["15000000"]]);
    expect(field().getAttribute("inputmode")).toBe("decimal");
    expect(field().type).toBe("text");
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("types 0.05 through its zeros", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} />);
    await user.type(field(), "0.05");
    expect(field().value).toBe("0.05");
    expect(spy).toHaveBeenLastCalledWith("500000");
  });

  it("types .5 and shows 0.5 after blur", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} />);
    await user.type(field(), ".5");
    expect(field().value).toBe(".5");
    expect(spy).toHaveBeenLastCalledWith("5000000");
    await user.tab();
    expect(field().value).toBe("0.5");
  });

  it("keeps a trailing point while focused, then normalises 10. to 10", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} />);
    await user.type(field(), "10.");
    expect(field().value).toBe("10.");
    expect(spy).toHaveBeenLastCalledWith("100000000");
    await user.tab();
    expect(field().value).toBe("10");
  });

  it("edits an existing amount without losing the point", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned initial="20000000" spy={spy} />);
    expect(field().value).toBe("2");
    await user.type(field(), ".25");
    expect(field().value).toBe("2.25");
    expect(spy).toHaveBeenLastCalledWith("22500000");
  });

  it("clears to an empty draft and commits 0, as the field did before", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned initial="15000000" spy={spy} />);
    await user.clear(field());
    expect(field().value).toBe("");
    expect(spy.mock.calls).toEqual([["0"]]);
    await user.type(field(), "3");
    expect(field().value).toBe("3");
    expect(spy).toHaveBeenLastCalledWith("30000000");
  });

  it("takes a pasted amount", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} />);
    await user.click(field());
    await user.paste("12.3456789");
    expect(field().value).toBe("12.3456789");
    expect(spy.mock.calls).toEqual([["123456789"]]);
  });

  it("refuses a pasted 1,5 instead of committing 15", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned initial="10000000" spy={spy} />);
    await user.click(field());
    await user.paste(",5");
    expect(field().value).toBe("1");
    expect(spy).not.toHaveBeenCalled();
    expect(describedText(field())).toBe("Use digits and one decimal point, like 1.5.");
  });

  it("refuses an eighth decimal rather than truncating it", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned spy={spy} />);
    await user.type(field(), "1.12345678");
    expect(field().value).toBe("1.1234567");
    expect(spy).toHaveBeenLastCalledWith("11234567");
    expect(describedText(field())).toBe("At most 7 decimal places.");
    await user.type(field(), "{Backspace}");
    expect(describedText(field())).toBe("");
  });

  it.each(["a", "-", "e", "+", "$", ",", "٣"])("refuses %j", async (ch) => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned initial="50000000" spy={spy} />);
    await user.click(field());
    await user.paste(ch);
    expect(field().value).toBe("5");
    expect(spy).not.toHaveBeenCalled();
  });

  it("commits exactly what tokenAmountToStroops committed for every accepted draft", () => {
    const drafts = [
      "0",
      "1",
      "1.",
      "1.5",
      "0.05",
      ".5",
      ".",
      "10.",
      "007",
      "0.0000001",
      "123.4567891",
      "922337203685.4775807",
      "170141183460469231731687303715884105727",
    ];
    for (const draft of drafts) {
      const spy = vi.fn();
      const { unmount } = render(<Owned initial="99" spy={spy} />);
      fireEvent.change(field(), { target: { value: draft } });
      expect([draft, spy.mock.calls.at(-1)?.[0]]).toEqual([draft, tokenAmountToStroops(draft)]);
      unmount();
    }
  });

  it("resets the draft when the value changes from outside", () => {
    const onChange = vi.fn();
    const { rerender } = render(<StroopsDraftInput value="10000000" onChange={onChange} />);
    fireEvent.change(field(), { target: { value: "1." } });
    expect(field().value).toBe("1.");
    rerender(<StroopsDraftInput value="25000000" onChange={onChange} />);
    expect(field().value).toBe("2.5");
    rerender(<StroopsDraftInput value={undefined} onChange={onChange} />);
    expect(field().value).toBe("");
  });

  it("passes the caller's placeholder and class through", () => {
    render(
      <StroopsDraftInput
        value={undefined}
        onChange={vi.fn()}
        placeholder="Any amount"
        className="input font-mono"
      />,
    );
    expect(field().placeholder).toBe("Any amount");
    expect(field().className).toBe("input font-mono");
  });

  it("shows 0 once a cleared field blurs, matching what the flow holds", async () => {
    const user = userEvent.setup();
    render(<Owned initial="15000000" spy={vi.fn()} />);
    await user.clear(field());
    await user.tab();
    expect(field().value).toBe("0");
  });

  it("keeps the note out of the field's name and clears it on blur", async () => {
    const user = userEvent.setup();
    const { container } = render(<Owned initial="10000000" spy={vi.fn()} />);
    await user.click(field());
    await user.paste("x");
    expect(screen.getByRole("textbox", { name: "Amount" })).toBe(field());
    expect(describedText(field())).toBe("Use digits and one decimal point, like 1.5.");
    expect((await axe.run(container)).violations).toEqual([]);
    await user.tab();
    expect(describedText(field())).toBe("");
  });

  it("merges a caller's aria-describedby with the note", async () => {
    const user = userEvent.setup();
    render(
      <>
        <p id="caller-hint">hint</p>
        <StroopsDraftInput value="1" onChange={vi.fn()} aria-describedby="caller-hint" />
      </>,
    );
    expect(describedText(field())).toBe("hint");
    await user.click(field());
    await user.paste("?");
    expect(describedText(field())).toBe("hint | Use digits and one decimal point, like 1.5.");
  });

  it("keeps an unsaved draft that still reads as the stored value", () => {
    const onChange = vi.fn();
    const { rerender } = render(<StroopsDraftInput value="10000000" onChange={onChange} />);
    fireEvent.change(field(), { target: { value: "1." } });
    rerender(<StroopsDraftInput value="10000000" onChange={onChange} />);
    expect(field().value).toBe("1.");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("falls back to the stored value on blur when the owner ignores a commit", () => {
    const onChange = vi.fn();
    render(<StroopsDraftInput value="10000000" onChange={onChange} />);
    fireEvent.change(field(), { target: { value: "2.5" } });
    expect(onChange).toHaveBeenCalledWith("25000000");
    expect(field().value).toBe("2.5");
    fireEvent.blur(field());
    expect(field().value).toBe("1");
  });
});
