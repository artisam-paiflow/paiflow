import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SwapPanel from "@/components/builder/panels/swap-panel";
import type { Asset, FlowNode } from "@/lib/flows/schema";
import { FlowPatchSchema } from "@/lib/flows/schema";
import { swapConfigIssues } from "@/lib/flows/swap-rules";

vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));

type SwapNode = Extract<FlowNode, { type: "swap" }>;

const ROUTER = "CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L";
const RECIPIENT = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const XLM: Asset = { kind: "native" };
const USDC: Asset = { kind: "known", symbol: "USDC" };

const SWAP: SwapNode = {
  id: "s",
  type: "swap",
  config: { assetIn: XLM, assetOut: USDC, slippageBps: 100, deadlineSecs: 300 },
};

/** The graph the builder would autosave with this swap node in it. */
function patchFor(node: FlowNode) {
  return {
    graph: {
      nodes: [
        { id: "t", type: "on_receive", config: { asset: XLM } },
        node,
        {
          id: "p",
          type: "pay",
          config: {
            recipient: RECIPIENT,
            asset: USDC,
            mode: "fixed",
            amountStroops: "1000000",
            fullAmount: true,
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "s" },
        { id: "e2", source: "s", target: "p" },
      ],
    },
  };
}

/**
 * Owns the node the way the builder does, and refuses — by recording — any
 * emission the save route's `FlowPatchSchema.parse` would reject (#583).
 */
function Owned({
  initial = SWAP,
  spy,
  refused,
  noRouter = false,
  errors = false,
}: {
  initial?: SwapNode;
  spy: (n: FlowNode) => void;
  refused: unknown[];
  noRouter?: boolean;
  errors?: boolean;
}) {
  const [node, setNode] = useState(initial);
  const issues = errors
    ? swapConfigIssues(node, { nextStepCount: 1, incomingAsset: null, triggerAsset: null })
    : [];
  return (
    <SwapPanel
      node={node}
      onChange={(n) => {
        spy(n);
        const parsed = FlowPatchSchema.safeParse(JSON.parse(JSON.stringify(patchFor(n))));
        if (!parsed.success) refused.push({ node: n, issues: parsed.error.issues });
        if (n.type === "swap") setNode(n);
      }}
      fieldError={(f) => issues.find((i) => i.field === f)?.friendlyMessage ?? null}
      expectedAsset={null}
      network="testnet"
      routerContractId={noRouter ? undefined : ROUTER}
    />
  );
}

function describedText(el: HTMLElement): string {
  return (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" | ");
}

async function axeViolations() {
  const results = await axe.run(document.body, { rules: { region: { enabled: false } } });
  return results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.html) }));
}

const assetIn = () => screen.getByRole("combobox", { name: "Asset In" }) as HTMLSelectElement;
const assetOut = () => screen.getByRole("combobox", { name: "Asset Out" }) as HTMLSelectElement;
const slippage = () =>
  screen.getByRole("textbox", { name: "Max slippage (%)" }) as HTMLInputElement;
const deadline = () =>
  screen.getByRole("textbox", { name: "Deadline (seconds)" }) as HTMLInputElement;
const preview = () => screen.getByRole("textbox", { name: "Preview amount" }) as HTMLInputElement;
const router = () => screen.getByRole("status", { name: /Router — Soroswap \(testnet\)/ });
const advanced = () => screen.getByTestId("swap-advanced") as HTMLDetailsElement;
const advancedToggle = () => screen.getByText("Advanced").closest("summary") as HTMLElement;

let fetchMock: ReturnType<typeof vi.fn>;
const quotedAmounts = () =>
  fetchMock.mock.calls.map(([url]) =>
    new URL(String(url), "http://x").searchParams.get("amountStroops"),
  );

beforeEach(() => {
  fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          data: { amountOutStroops: "10500000", amountOutMinStroops: "10400000" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SwapPanel", () => {
  it("is built from the four shared inputs, each labelled, in tab order", async () => {
    const user = userEvent.setup();
    const refused: unknown[] = [];
    render(<Owned spy={vi.fn()} refused={refused} />);

    // Router and deadline sit under Advanced, collapsed until asked for.
    expect(advanced().open).toBe(false);
    await user.click(advancedToggle());
    expect(advanced().open).toBe(true);

    // AssetSelect ×2, AddressPicker (pinned), ShareInput, AmountInput.
    expect(assetIn().tagName).toBe("SELECT");
    expect(assetOut().tagName).toBe("SELECT");
    expect(router().tagName).toBe("OUTPUT");
    expect(router().textContent).toContain(ROUTER);
    expect(slippage().value).toBe("1");
    expect(deadline().value).toBe("300");
    expect(preview().value).toBe("10");
    // A lone percentage: ShareInput renders no remainder line.
    expect(screen.queryByText(/left of 100%/)).toBeNull();
    // None carries ConfigPanel's legacy `.input` class.
    expect(document.querySelector(".input")).toBeNull();

    (document.activeElement as HTMLElement | null)?.blur();
    const order = [
      assetIn(),
      assetOut(),
      slippage(),
      preview(),
      advancedToggle(),
      screen.getByRole("button", { name: /Copy Router/ }),
      screen.getByRole("link", { name: /View Router .* on stellar\.expert/ }),
      deadline(),
    ];
    for (const el of order) {
      await user.tab();
      expect(document.activeElement).toBe(el);
    }
    expect(await axeViolations()).toEqual([]);
  });

  it("renders an error from the issue map on its field and describes it", async () => {
    const refused: unknown[] = [];
    render(
      <Owned
        initial={{ ...SWAP, config: { ...SWAP.config, slippageBps: 0 } }}
        spy={vi.fn()}
        refused={refused}
        errors
      />,
    );
    expect(slippage().getAttribute("aria-invalid")).toBe("true");
    expect(describedText(slippage())).toMatch(/pool fee is 0\.3%/);
    expect(assetOut().getAttribute("aria-invalid")).toBeNull();
    expect(await axeViolations()).toEqual([]);
  });

  it("puts the same-asset message on Asset Out", async () => {
    const user = userEvent.setup();
    const refused: unknown[] = [];
    const spy = vi.fn();
    render(<Owned spy={spy} refused={refused} errors />);
    await user.selectOptions(assetOut(), "native");
    expect(assetOut().getAttribute("aria-invalid")).toBe("true");
    expect(describedText(assetOut())).toMatch(/two different assets/);
    expect(assetIn().getAttribute("aria-invalid")).toBeNull();
    // Wholly the old shape: a catalogue asset, nothing else in config changed.
    expect(spy).toHaveBeenLastCalledWith({ ...SWAP, config: { ...SWAP.config, assetOut: XLM } });
    expect(refused).toEqual([]);
  });

  it("lets 0.5 be typed into slippage and clamps 0.1 on blur with a note", async () => {
    const user = userEvent.setup();
    const refused: unknown[] = [];
    const spy = vi.fn();
    render(<Owned spy={spy} refused={refused} />);

    await user.clear(slippage());
    await user.type(slippage(), "0.5");
    expect(slippage().value).toBe("0.5");
    expect(spy.mock.calls.map(([n]) => n.config.slippageBps)).toEqual([50]);

    await user.clear(slippage());
    await user.type(slippage(), "0.1");
    await user.tab();
    expect(slippage().value).toBe("0.3");
    expect(spy.mock.lastCall?.[0].config.slippageBps).toBe(30);
    expect(describedText(slippage())).toContain("Raised to the minimum, 0.3%.");
    // The static requirement stays alongside the note.
    expect(describedText(slippage())).toContain("At least 0.3%");
    expect(refused).toEqual([]);
  });

  it("writes nothing when slippage or the deadline is cleared, and clamps the deadline on blur", async () => {
    const user = userEvent.setup();
    const refused: unknown[] = [];
    const spy = vi.fn();
    render(<Owned spy={spy} refused={refused} />);

    await user.clear(slippage());
    await user.tab();
    await user.clear(deadline());
    await user.tab();
    expect(spy).not.toHaveBeenCalled();
    expect(describedText(deadline())).toContain("Empty — the flow still uses 300 seconds.");

    await user.type(deadline(), "999999");
    await user.tab();
    expect(deadline().value).toBe("86400");
    expect(spy.mock.lastCall?.[0].config.deadlineSecs).toBe(86_400);
    expect(describedText(deadline())).toContain("Lowered to the maximum, 86400 seconds.");

    await user.clear(deadline());
    await user.type(deadline(), "1.5");
    expect(describedText(deadline())).toContain("Whole numbers only.");
    expect(refused).toEqual([]);
  });

  it("emits no config FlowPatchSchema refuses, whatever is typed", async () => {
    const user = userEvent.setup();
    const refused: unknown[] = [];
    const spy = vi.fn();
    render(<Owned spy={spy} refused={refused} />);

    for (const field of [slippage, deadline]) {
      for (const text of ["0", "00", "0.", "-1", "1e3", "100.001", "99999999999", "12,5", " 7 "]) {
        await user.clear(field());
        await user.type(field(), text);
        await user.tab();
      }
    }
    await user.clear(slippage());
    await user.type(slippage(), "100");
    await user.clear(slippage());
    await user.type(slippage(), "250");
    await user.tab();
    await user.click(assetIn());
    await user.selectOptions(assetIn(), "known:USDC");

    expect(spy).toHaveBeenCalled();
    expect(refused).toEqual([]);
    for (const [n] of spy.mock.calls) {
      expect(Object.keys(n.config).sort()).toEqual(
        ["assetIn", "assetOut", "deadlineSecs", "slippageBps"].sort(),
      );
    }
  });

  it("keeps the preview amount out of the graph and quotes only committed amounts", async () => {
    const user = userEvent.setup();
    const refused: unknown[] = [];
    const spy = vi.fn();
    render(<Owned spy={spy} refused={refused} />);
    await waitFor(() => expect(quotedAmounts()).toEqual(["100000000"]));

    await user.clear(preview());
    await user.type(preview(), "2500.");
    await waitFor(() =>
      expect(screen.getByTestId("swap-quote").textContent).toMatch(/for 2500 XLM ·/),
    );
    await user.tab();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(spy).not.toHaveBeenCalled();
    // Debounced, and never a draft: no "", "2500." or partial string was quoted.
    expect(quotedAmounts()).toEqual(["100000000", "25000000000"]);
    expect(describedText(preview())).toContain("Preview only");
  });

  it("says a cleared preview amount still quotes the last one, not that the flow uses it", async () => {
    const user = userEvent.setup();
    const refused: unknown[] = [];
    const spy = vi.fn();
    render(<Owned spy={spy} refused={refused} />);

    await user.clear(preview());
    await user.tab();
    expect(spy).not.toHaveBeenCalled();
    expect(describedText(preview())).toContain("Empty — the preview still quotes 10 XLM.");
    expect(describedText(preview())).not.toContain("the flow still uses");
  });

  it("cannot edit the router by typing or pasting", async () => {
    const user = userEvent.setup();
    const refused: unknown[] = [];
    const spy = vi.fn();
    render(<Owned spy={spy} refused={refused} />);

    expect(screen.queryByRole("textbox", { name: /Router/ })).toBeNull();
    const out = router();
    await user.click(out);
    await user.keyboard("GBADADDRESS");
    fireEvent.paste(out, { clipboardData: { getData: () => "CEVIL" } });
    expect(out.textContent).toContain(ROUTER);
    expect(out.textContent).not.toContain("GBADADDRESS");
    expect(spy).not.toHaveBeenCalled();
  });

  it("names an unconfigured router instead of showing an address", async () => {
    const refused: unknown[] = [];
    render(<Owned spy={vi.fn()} refused={refused} noRouter />);
    expect(screen.getByText("Not configured on this environment")).toBeTruthy();
    // Nothing to flag is ever collapsed away.
    expect(advanced().open).toBe(true);
    expect(screen.queryByRole("link", { name: /stellar\.expert/ })).toBeNull();
    expect(await axeViolations()).toEqual([]);
  });

  it("shows the quote as a figure with its minimum", async () => {
    render(<Owned spy={vi.fn()} refused={[]} />);
    const quote = await screen.findByText("≈ 1.05 USDC");
    expect(quote.closest("[data-testid=swap-quote]")?.textContent).toContain(
      "for 10 XLM · at least 1.04 USDC at 1% slippage",
    );
  });

  it("opens Advanced by itself when the deadline has an error", async () => {
    render(
      <SwapPanel
        node={SWAP}
        onChange={vi.fn()}
        fieldError={(f) => (f === "deadlineSecs" ? "Deadline must be 1–86,400 seconds." : null)}
        expectedAsset={null}
        network="testnet"
        routerContractId={ROUTER}
      />,
    );
    expect(advanced().open).toBe(true);
    expect(deadline().getAttribute("aria-invalid")).toBe("true");
    expect(await axeViolations()).toEqual([]);
  });
});
