import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DeployReview from "@/components/deploy/deploy-review";
import type { TrustlineCheck } from "@/lib/stellar/trustline-check";

vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));

const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const RECIPIENT = "GAUF2ILE2UGAAFJZBUSICBTRMOL5TDGBZRXHYO4O5P5RMAPJ24YCV2XQ";

function deferred() {
  let resolve!: (checks: TrustlineCheck[]) => void;
  const promise = new Promise<TrustlineCheck[]>((r) => (resolve = r));
  return { promise, resolve };
}

// Awaited so React flushes effects around a suspended `use()`; a sync render
// leaves the passive effects, and with them the gate, unflushed.
async function renderReview(trustlineCheck?: Promise<TrustlineCheck[]>) {
  await act(async () => {
    render(<DeployReview flowId="f" network="testnet" trustlineCheck={trustlineCheck} />);
  });
}

function deployButton() {
  return screen.getByRole("button", { name: /deploy to testnet|checking recipients/i });
}

// #574: the warning has to be on screen before the user can start signing.
describe("DeployReview trustline check gate", () => {
  it("holds Deploy until the check settles, then shows the warning and enables it", async () => {
    const check = deferred();
    await renderReview(check.promise);

    expect(screen.getByRole("status").textContent).toBe("Checking recipient trustlines…");
    expect((deployButton() as HTMLButtonElement).disabled).toBe(true);
    expect(deployButton().textContent).toContain("CHECKING RECIPIENTS");

    await act(async () => {
      check.resolve([
        {
          nodeId: "p",
          address: RECIPIENT,
          status: "no_trustline",
          assetCode: "USDC",
          assetIssuer: USDC_ISSUER,
          otherIssuers: [],
        },
      ]);
    });

    expect(await screen.findByRole("region", { name: /can't receive this payout/i })).toBeTruthy();
    expect((deployButton() as HTMLButtonElement).disabled).toBe(false);
    expect(deployButton().textContent).toContain("DEPLOY TO TESTNET");
  });

  it("does not block when Horizon could not be asked", async () => {
    const check = deferred();
    await renderReview(check.promise);

    await act(async () => {
      check.resolve([
        {
          nodeId: "p",
          address: RECIPIENT,
          status: "unknown",
          assetCode: "USDC",
          assetIssuer: USDC_ISSUER,
        },
      ]);
    });

    expect(
      (await screen.findByRole("region")).textContent?.includes("Couldn't check recipient"),
    ).toBe(true);
    expect((deployButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("enables Deploy after the wait cap even if the check never arrives", async () => {
    vi.useFakeTimers();
    try {
      await renderReview(new Promise(() => {}));
      expect((deployButton() as HTMLButtonElement).disabled).toBe(true);
      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });
      expect((deployButton() as HTMLButtonElement).disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("enables Deploy immediately when there is nothing to check", async () => {
    await renderReview();
    expect((deployButton() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
