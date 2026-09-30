import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrustlineWarningList } from "@/components/deploy/trustline-warnings";
import type { TrustlineCheck } from "@/lib/stellar/trustline-check";

const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const WRONG_ISSUER = "GCF323WKLA4IEBYRRSUSIXKFECZDQDMIFPB5EENSQY26QWRRG7VIDLRK";
const RECIPIENT = "GAUF2ILE2UGAAFJZBUSICBTRMOL5TDGBZRXHYO4O5P5RMAPJ24YCV2XQ";

const base = { nodeId: "p", address: RECIPIENT };

describe("TrustlineWarningList", () => {
  it("renders nothing when every recipient can receive the payout", () => {
    const { container } = render(
      <TrustlineWarningList
        checks={[
          { ...base, status: "ok", assetCode: "USDC", assetIssuer: USDC_ISSUER },
          { ...base, status: "not_needed" },
          { ...base, status: "skipped" },
        ]}
        network="testnet"
        context="deploy"
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("names the asset, the flow's issuer and the wrong issuer the recipient trusts", () => {
    const checks: TrustlineCheck[] = [
      {
        ...base,
        label: "Alice",
        status: "no_trustline",
        assetCode: "USDC",
        assetIssuer: USDC_ISSUER,
        otherIssuers: [WRONG_ISSUER],
      },
    ];
    render(<TrustlineWarningList checks={checks} network="testnet" context="deploy" />);

    const region = screen.getByRole("region", { name: /can't receive this payout/i });
    const item = within(region).getByRole("listitem");
    expect(item.textContent).toContain("Alice");
    expect(item.textContent).toContain("has no USDC trustline from issuer");
    expect(item.textContent).toContain("which is a different asset");
    // The full issuer is one click away, not only its truncation.
    const copy = within(item).getByRole("button", { name: "Copy USDC issuer address" });
    expect(copy.getAttribute("title")).toBe(USDC_ISSUER);
    expect(
      within(item).getByRole("button", { name: "Copy other issuer address" }).getAttribute("title"),
    ).toBe(WRONG_ISSUER);
    expect(region.textContent).toContain("you can still deploy");
  });

  it("warns that a missing account does not exist on the network", () => {
    render(
      <TrustlineWarningList
        checks={[{ ...base, status: "no_account", assetCode: "USDC", assetIssuer: USDC_ISSUER }]}
        network="testnet"
        context="trigger"
      />,
    );
    const item = screen.getByRole("listitem");
    expect(item.textContent).toContain("does not exist on testnet yet");
    expect(screen.getByRole("region").textContent).toContain("You can still trigger");
  });

  it("degrades a Horizon failure to a muted note", () => {
    render(
      <TrustlineWarningList
        checks={[{ ...base, status: "unknown", assetCode: "USDC", assetIssuer: USDC_ISSUER }]}
        network="testnet"
        context="deploy"
      />,
    );
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.getByRole("region").textContent).toBe(
      "Couldn't check recipient trustlines for 1 account right now.",
    );
  });
});
