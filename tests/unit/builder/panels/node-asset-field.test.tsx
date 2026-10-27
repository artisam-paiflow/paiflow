import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NodeAssetField } from "@/components/builder/panels/node-asset-field";
import type { Asset } from "@/lib/flows/schema";

const XLM: Asset = { kind: "native" };
const USDC: Asset = { kind: "known", symbol: "USDC" };

describe("Shared asset selection for non-swap nodes", () => {
  it("retains upstream restrictions and field-error wiring", () => {
    render(
      <NodeAssetField asset={USDC} expectedAsset={XLM} onChange={vi.fn()} error="Asset mismatch" />,
    );
    const select = screen.getByRole("combobox", { name: "Asset" });
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByRole("option", { name: "USDC" }) as HTMLOptionElement).disabled).toBe(true);
    expect(
      select
        .getAttribute("aria-describedby")!
        .split(" ")
        .some((id) => document.getElementById(id)?.textContent === "Asset mismatch"),
    ).toBe(true);
  });

  it("adopts an upstream custom asset read-only rather than applying Swapper's rejection policy", async () => {
    const custom: Asset = {
      kind: "custom",
      code: "USD",
      issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    };
    const onChange = vi.fn();
    render(<NodeAssetField asset={USDC} expectedAsset={custom} onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(custom));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(/USD \(issuer/)).toBeTruthy();
  });
});
