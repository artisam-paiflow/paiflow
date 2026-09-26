import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { ShareInput } from "@/components/builder/inputs/share-input";
import { MIN_SWAP_SLIPPAGE_BPS } from "@/lib/flows/schema";

function describedText(el: HTMLElement): string {
  return (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" | ");
}

function Owned({
  initial,
  spy,
  ...props
}: { initial: number; spy: (bps: number) => void } & Partial<
  React.ComponentProps<typeof ShareInput>
>) {
  const [value, setValue] = useState(initial);
  return (
    <ShareInput
      label="Max slippage"
      {...props}
      value={value}
      onChange={(bps) => {
        spy(bps);
        setValue(bps);
      }}
    />
  );
}

const slippage = () => screen.getByRole("textbox", { name: "Max slippage" }) as HTMLInputElement;

describe("ShareInput", () => {
  it("lets slippage 0.5 be typed past a 0.3 floor and commits 50 bps", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const { container } = render(<Owned initial={100} spy={spy} minBps={MIN_SWAP_SLIPPAGE_BPS} />);
    expect(slippage().value).toBe("1");
    await user.clear(slippage());
    await user.type(slippage(), "0.5");
    expect(slippage().value).toBe("0.5");
    expect(spy.mock.calls).toEqual([[50]]);
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("raises 0.1 to 0.3 on blur and says so", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const { container } = render(<Owned initial={100} spy={spy} minBps={MIN_SWAP_SLIPPAGE_BPS} />);
    await user.clear(slippage());
    await user.type(slippage(), "0.1");
    expect(spy).not.toHaveBeenCalled();
    await user.tab();
    expect(spy.mock.calls).toEqual([[30]]);
    expect(slippage().value).toBe("0.3");
    expect(describedText(slippage())).toBe("Raised to the minimum, 0.3%.");
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("types a fractional percent exactly", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Owned initial={0} spy={spy} />);
    await user.clear(slippage());
    await user.type(slippage(), "12.5");
    expect(slippage().value).toBe("12.5");
    expect(spy).toHaveBeenLastCalledWith(1250);
    await user.type(slippage(), "5");
    expect(spy).toHaveBeenLastCalledWith(1255);
    await user.type(slippage(), "5");
    expect(slippage().value).toBe("12.55");
    expect(describedText(slippage())).toBe("At most 2 decimal places.");
  });

  it("renders no remainder line without remainingBps (the swapper's shape)", () => {
    render(<ShareInput label="Max slippage" value={100} onChange={() => {}} />);
    expect(slippage().getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByText(/left of 100%/)).toBeNull();
    expect(screen.getByText("%").getAttribute("aria-hidden")).toBe("true");
  });

  it("reports the remainder and an over-allocation as one of a splitter's shares", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const { container } = render(
      <Owned initial={2500} spy={spy} label="Recipient share" remainingBps={4000} />,
    );
    const share = screen.getByRole("textbox", { name: "Recipient share" }) as HTMLInputElement;
    expect(share.getAttribute("aria-invalid")).toBeNull();
    expect(describedText(share)).toBe("15% left of 100%.");
    expect((await axe.run(container)).violations).toEqual([]);

    await user.clear(share);
    await user.type(share, "50");
    // Sum-to-100 is validateFlow's rule, not the schema's: the share still commits.
    expect(spy).toHaveBeenLastCalledWith(5000);
    expect(share.getAttribute("aria-invalid")).toBe("true");
    expect(describedText(share)).toBe("Over-allocated by 10%: the shares add up to 110%.");
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("keeps a caller's error over its own over-allocation message", () => {
    render(
      <ShareInput
        label="Recipient share"
        value={5000}
        remainingBps={4000}
        onChange={() => {}}
        error="Add a recipient address."
      />,
    );
    const share = screen.getByRole("textbox", { name: "Recipient share" });
    expect(describedText(share)).toBe("Add a recipient address.");
  });

  it("shows the over-allocation when the caller's error is empty", () => {
    render(
      <ShareInput
        label="Recipient share"
        value={5000}
        remainingBps={4000}
        onChange={() => {}}
        error=""
      />,
    );
    const share = screen.getByRole("textbox", { name: "Recipient share" });
    expect(describedText(share)).toContain("Over-allocated by 10%");
  });
});
