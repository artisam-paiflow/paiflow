import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { Field } from "@/components/builder/inputs/field";
import { inputClass } from "@/components/builder/inputs/styles";

function describedText(el: HTMLElement): string {
  return (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? `<missing ${id}>`)
    .join(" | ");
}

function Deadline({ error }: { error?: string | null }) {
  return (
    <Field label="Deadline (seconds)" hint="Bounds the ledger close time." error={error}>
      {(control) => <input {...control} className={inputClass} defaultValue="300" />}
    </Field>
  );
}

describe("Field", () => {
  it("names the control through htmlFor and describes it with the hint", async () => {
    const { container } = render(<Deadline />);
    const input = screen.getByRole("textbox", { name: "Deadline (seconds)" });
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(describedText(input)).toBe("Bounds the ledger close time.");
    expect(input.className).not.toMatch(/(^|\s)input(\s|$)/);
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("marks the control invalid and describes it with the error, outside its name", async () => {
    const { container } = render(<Deadline error="Must be at least 1 second." />);
    const input = screen.getByRole("textbox", { name: "Deadline (seconds)" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(describedText(input)).toBe("Bounds the ledger close time. | Must be at least 1 second.");
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("keeps one polite error region whose text changes only with the message", () => {
    const { rerender } = render(<Deadline />);
    const input = screen.getByRole("textbox");
    const regionId = `${input.id.replace(/-control$/, "")}-error`;
    const region = document.getElementById(regionId);
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(region?.textContent).toBe("");

    rerender(<Deadline error="Too long." />);
    expect(document.getElementById(regionId)).toBe(region);
    expect(region?.textContent).toBe("Too long.");

    // A keystroke that leaves the message unchanged mutates nothing to announce.
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((m) => mutations.push(...m));
    observer.observe(region!, { childList: true, characterData: true, subtree: true });
    rerender(<Deadline error="Too long." />);
    observer.disconnect();
    expect(mutations.concat(observer.takeRecords())).toEqual([]);
  });

  it("describes the control with a note in its own polite region", async () => {
    const { container, rerender } = render(
      <Field label="Amount" hint="In USDC.">
        {(control) => <input {...control} className={inputClass} defaultValue="100" />}
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Amount" });
    const region = document.getElementById(`${input.id.replace(/-control$/, "")}-note`);
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(describedText(input)).toBe("In USDC.");

    rerender(
      <Field label="Amount" hint="In USDC." note="Lowered to the maximum, 100 USDC.">
        {(control) => <input {...control} className={inputClass} defaultValue="100" />}
      </Field>,
    );
    expect(document.getElementById(region!.id)).toBe(region);
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(describedText(input)).toBe("In USDC. | Lowered to the maximum, 100 USDC.");
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("labels a composite control as a group without naming only its first child", async () => {
    const { container } = render(
      <Field label="Window" hint="Both ends inclusive." error="End is before start." group>
        <input aria-label="Start" className={inputClass} defaultValue="1" />
        <input aria-label="End" className={inputClass} defaultValue="0" />
      </Field>,
    );
    const group = screen.getByRole("group", { name: "Window" });
    expect(group.getAttribute("aria-invalid")).toBe("true");
    expect(describedText(group)).toBe("Both ends inclusive. | End is before start.");
    expect(screen.getByRole("textbox", { name: "Start" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "End" })).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
