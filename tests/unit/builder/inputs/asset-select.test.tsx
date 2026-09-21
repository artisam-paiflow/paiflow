import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { AssetSelect } from "@/components/builder/inputs/asset-select";
import type { Asset } from "@/lib/flows/schema";

const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const CUSTOM: Asset = { kind: "custom", code: "EURC", issuer: ISSUER };
const USDC: Asset = { kind: "known", symbol: "USDC" };
const XLM: Asset = { kind: "native" };

function describedText(el: HTMLElement): string {
  return (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" | ");
}

function option(name: string): HTMLOptionElement {
  return screen.getByRole("option", { name }) as HTMLOptionElement;
}

describe("AssetSelect", () => {
  it("is a labelled select that reports the picked asset", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<AssetSelect label="Asset In" value={USDC} onChange={onChange} />);
    const select = screen.getByRole("combobox", { name: "Asset In" });
    expect(select.getAttribute("aria-invalid")).toBeNull();

    await user.selectOptions(select, "XLM (native)");
    expect(onChange).toHaveBeenCalledWith(XLM);
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("wires an error to the select", async () => {
    const { container } = render(
      <AssetSelect
        label="Asset Out"
        value={USDC}
        onChange={() => {}}
        error="Pick a different asset."
      />,
    );
    const select = screen.getByRole("combobox", { name: "Asset Out" });
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(describedText(select)).toBe("Pick a different asset.");
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("disables options that differ from the upstream asset and says why", async () => {
    const { container } = render(
      <AssetSelect label="Asset In" value={XLM} onChange={() => {}} expectedAsset={XLM} />,
    );
    expect(option("USDC").disabled).toBe(true);
    expect(option("XLM (native)").disabled).toBe(false);
    const select = screen.getByRole("combobox", { name: "Asset In" });
    expect(describedText(select)).toMatch(/Only XLM can be picked here/);
    expect(select.getAttribute("title")).toBeNull();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('"error" policy shows an upstream custom asset and never writes it', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <AssetSelect
        label="Asset In"
        value={USDC}
        onChange={onChange}
        expectedAsset={CUSTOM}
        onUpstreamCustom="error"
      />,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    const readout = screen.getByRole("status", { name: "Asset In" });
    expect(readout.textContent).toMatch(/^EURC/);
    expect(readout.getAttribute("aria-invalid")).toBe("true");
    expect(describedText(readout)).toMatch(/delivers EURC \(issuer GA5ZSE…/);
    expect(onChange).not.toHaveBeenCalled();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('"adopt" policy writes the upstream custom asset once', () => {
    const onChange = vi.fn();
    function Adopting() {
      const [value, setValue] = useState<Asset>(USDC);
      return (
        <AssetSelect
          label="Asset"
          value={value}
          onChange={(a) => {
            onChange(a);
            setValue(a);
          }}
          expectedAsset={CUSTOM}
          onUpstreamCustom="adopt"
        />
      );
    }
    render(<Adopting />);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(CUSTOM);
    expect(screen.getByRole("status", { name: "Asset" }).getAttribute("aria-invalid")).toBeNull();
  });

  it("shows a saved value the catalogue does not offer instead of the first option", async () => {
    const { container } = render(<AssetSelect label="Asset" value={CUSTOM} onChange={() => {}} />);
    const select = screen.getByRole("combobox", { name: "Asset" }) as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent).toMatch(/^EURC .*\(not available\)$/);
    expect(select.selectedOptions[0]?.disabled).toBe(true);
    expect((await axe.run(container)).violations).toEqual([]);
  });

  // Reuse evidence: a trigger-style asset picker, no swap-specific props.
  it("works with a plain non-swap props shape", async () => {
    const user = userEvent.setup();
    function TriggerAsset() {
      const [asset, setAsset] = useState<Asset>(XLM);
      return (
        <AssetSelect
          label="Asset"
          hint="What the payer deposits."
          value={asset}
          onChange={setAsset}
        />
      );
    }
    const { container } = render(<TriggerAsset />);
    const select = screen.getByRole("combobox", { name: "Asset" }) as HTMLSelectElement;
    expect(describedText(select)).toBe("What the payer deposits.");
    await user.selectOptions(select, "USDC");
    expect(select.value).toBe("known:USDC");
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
