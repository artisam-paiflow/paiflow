import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { AssetSchema } from "@/lib/flows/schema";

// Circle's USDC issuer on mainnet: a real, checksummed G… account.
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

function LabelledInput() {
  const [value, setValue] = useState("");
  return (
    <div>
      <label htmlFor="smoke-input">Amount</label>
      <input id="smoke-input" value={value} onChange={(e) => setValue(e.target.value)} />
      <output aria-label="Echo">{value}</output>
    </div>
  );
}

describe("dom project smoke test", () => {
  it("renders a component and updates on user input", async () => {
    const user = userEvent.setup();
    render(<LabelledInput />);

    const input = screen.getByRole("textbox", { name: "Amount" });
    await user.type(input, "1.5");

    expect((input as HTMLInputElement).value).toBe("1.5");
    expect(screen.getByRole("status", { name: "Echo" }).textContent).toBe("1.5");
  });

  it("runs axe-core against the rendered tree", async () => {
    const { container } = render(<LabelledInput />);
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  // Under jsdom vitest resolves the `browser` export condition, so this pulls
  // @stellar/stellar-sdk's browser build through lib/flows/schema.ts.
  it("validates a Stellar address through lib/flows/schema.ts", () => {
    const ok = AssetSchema.safeParse({ kind: "custom", code: "USDC", issuer: USDC_ISSUER });
    expect(ok.success).toBe(true);

    const bad = AssetSchema.safeParse({ kind: "custom", code: "USDC", issuer: "GNOTANADDRESS" });
    expect(bad.success).toBe(false);
  });
});
