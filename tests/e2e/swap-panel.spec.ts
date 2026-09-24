/**
 * Instawards D1 (#389) evidence: the Swap block in the builder, its config
 * panel, the English preview, each edge-case validation error, and the deploy
 * review with the network chip. Writes PNGs into docs/instawards/evidence/d1/.
 *
 * Run against a live dev server:
 *   PLAYWRIGHT_NO_SERVER=1 ADMIN_SEED_PASSWORD=… pnpm exec playwright test \
 *     tests/e2e/swap-panel.spec.ts --project=chromium-desktop
 */
import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const OUT = "docs/instawards/evidence/d1";
const RECIPIENT = "GC5Q654OUY2FMR6TVBCTQYNGZLGX4ZCGUJ5XDE2UMBSLYYHTNIN3L6O6";
const XLM = { kind: "native" };
const USDC = { kind: "known", symbol: "USDC" };

function graph(
  overrides: {
    triggerAsset?: unknown;
    swap?: Record<string, unknown>;
    extraEdge?: boolean;
  } = {},
) {
  const nodes: unknown[] = [
    { id: "t", type: "on_receive", config: { asset: overrides.triggerAsset ?? XLM } },
    {
      id: "s",
      type: "swap",
      config: {
        assetIn: XLM,
        assetOut: USDC,
        slippageBps: 100,
        deadlineSecs: 300,
        ...overrides.swap,
      },
    },
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
  ];
  const edges = [
    { id: "e1", source: "t", target: "s" },
    { id: "e2", source: "s", target: "p" },
  ];
  const positions: Record<string, { x: number; y: number }> = {
    t: { x: 40, y: 120 },
    s: { x: 360, y: 120 },
    p: { x: 680, y: 120 },
  };
  if (overrides.extraEdge) {
    nodes.push({
      id: "p2",
      type: "pay",
      config: {
        recipient: RECIPIENT,
        asset: USDC,
        mode: "fixed",
        amountStroops: "1000000",
        fullAmount: true,
      },
    });
    edges.push({ id: "e3", source: "s", target: "p2" });
    positions.p2 = { x: 680, y: 320 };
  }
  return { nodes, edges, positions };
}

async function openSwapPanel(page: Page, flowId: string) {
  await page.goto(`/flows/${flowId}`);
  await page.waitForSelector(".react-flow__node", { timeout: 20_000 });
  await page.locator(".react-flow__node", { hasText: "Swap" }).first().click();
  const panel = page.getByTestId("config-panel");
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("Swap block (Instawards D1)", () => {
  // Desktop only. The evidence PNGs are written to fixed paths, so a second
  // project would overwrite them, and below 768px the builder starts with the
  // sidebar collapsed (builder-client.tsx), which hides the palette entirely.
  test.skip(({ isMobile }) => isMobile, "D1 evidence is captured on the desktop project");

  // The floating config panel is taller than the default viewport; element
  // screenshots clip to the viewport, so give the evidence room.
  test.use({ viewport: { width: 1440, height: 1600 } });

  let flowId!: string;

  test.beforeAll(async ({ request }) => {
    // page.screenshot() creates its parent directory but writeFile() does not,
    // so the JSON cases below would depend on a screenshot having run first.
    await mkdir(OUT, { recursive: true });
    const res = await request.post("/api/flows", {
      data: { name: "D1 swap evidence", graph: graph() },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    flowId = (await res.json()).data.id;
  });

  // The spec runs against a live server (paiflow.xyz on evidence day), so it
  // takes its flow away with it rather than leaving one behind per run.
  test.afterAll(async ({ request }) => {
    if (!flowId) return;
    await request.delete(`/api/flows/${flowId}`);
  });

  test("Swap is in the palette and the panel shows slippage, deadline and the router", async ({
    page,
  }) => {
    const panel = await openSwapPanel(page, flowId);
    await expect(page.getByTestId("palette-swap")).toBeVisible();
    await expect(panel.getByText("Max slippage (%)")).toBeVisible();
    await panel.locator("summary", { hasText: "Advanced" }).click();
    await expect(panel.getByText("Deadline (seconds)")).toBeVisible();
    // Pinned and read-only (#612): the actual router contract, with nothing to
    // type into. The label names the network, which reaches the panel as a
    // server prop (STELLAR_NETWORK), never a NEXT_PUBLIC_ copy that could drift.
    const routerField = panel.getByTestId("swap-router");
    await expect(routerField).toContainText("Soroswap (testnet)");
    await expect(routerField.getByRole("textbox")).toHaveCount(0);
    await expect(routerField.getByRole("combobox")).toHaveCount(0);
    // A public contract id. Playwright does not load the app's .env, and the
    // spec also runs against a live server, so compare exactly only when set.
    const router = process.env.STELLAR_SOROSWAP_ROUTER_TESTNET;
    await expect(routerField).toContainText(
      router ?? /C[A-Z2-7]{55}|Not configured on this environment/,
    );
    await expect(panel.getByText(/At least 0\.3%, to cover Soroswap's fee/)).toBeVisible();
    await expect(
      page.getByText(/swap XLM to USDC via Soroswap with up to 1% slippage/),
    ).toBeVisible();
    await page.screenshot({ path: `${OUT}/01-builder-swap-flow.png`, animations: "disabled" });
    await panel.screenshot({ path: `${OUT}/02-swap-panel-after.png`, animations: "disabled" });
  });

  const panelCases: Array<{
    name: string;
    file: string;
    graph: ReturnType<typeof graph>;
    expect: RegExp;
  }> = [
    {
      name: "assetIn does not match the incoming asset",
      file: "03-error-asset-mismatch.png",
      graph: graph({ triggerAsset: USDC }),
      expect: /Asset mismatch/,
    },
    {
      name: "more than one outgoing edge",
      file: "04-error-two-edges.png",
      graph: graph({ extraEdge: true }),
      expect: /one next step/,
    },
    {
      name: "both sides of the swap are the same asset",
      file: "06-error-same-asset.png",
      graph: graph({ swap: { assetOut: XLM } }),
      expect: /two different assets/,
    },
  ];

  for (const c of panelCases) {
    test(`edge case in the panel: ${c.name}`, async ({ page, request }) => {
      const res = await request.patch(`/api/flows/${flowId}`, { data: { graph: c.graph } });
      expect(res.ok(), await res.text()).toBeTruthy();
      const panel = await openSwapPanel(page, flowId);
      await expect(panel.getByText(c.expect).first()).toBeVisible();
      await panel.screenshot({ path: `${OUT}/${c.file}`, animations: "disabled" });
    });
  }

  // Out-of-range slippage and deadline never reach the panel: the graph schema
  // rejects them at the API boundary (422 with the field path), and the panel's
  // inputs hold a draft and clamp it to the same range on blur. The evidence
  // for these two is the server response, saved as text next to the screenshots.
  const apiCases: Array<{
    name: string;
    file: string;
    graph: ReturnType<typeof graph>;
    field: string;
  }> = [
    {
      name: "slippageBps outside 0–10000",
      file: "05-error-slippage-range.json",
      graph: graph({ swap: { slippageBps: 20_000 } }),
      field: "graph.nodes.1.config.slippageBps",
    },
    {
      name: "deadlineSecs below 1",
      file: "06-error-deadline.json",
      graph: graph({ swap: { deadlineSecs: 0 } }),
      field: "graph.nodes.1.config.deadlineSecs",
    },
  ];

  for (const c of apiCases) {
    test(`edge case at the API boundary: ${c.name}`, async ({ request }) => {
      const res = await request.patch(`/api/flows/${flowId}`, { data: { graph: c.graph } });
      expect(res.status()).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION");
      expect(Object.keys(json.error.fields)).toContain(c.field);
      const { writeFile } = await import("node:fs/promises");
      await writeFile(
        `${OUT}/${c.file}`,
        JSON.stringify({ request: c.graph, response: json }, null, 2),
      );
    });
  }

  // Under Soroswap's 0.3% fee every trigger reverts, so a new flow cannot be
  // saved with it (#453). The contract-level proof is the swapper crate's
  // `zero_slippage_reverts_on_the_pool_fee_alone`.
  test("edge case at the API boundary: slippage under the 0.3% floor is refused on create", async ({
    request,
  }) => {
    const res = await request.post("/api/flows", {
      data: { name: "D1 swap 0 bps", graph: graph({ swap: { slippageBps: 0 } }) },
    });
    expect(res.status()).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("VALIDATION");
    expect(Object.keys(json.error.fields).some((k) => k.endsWith("config.slippageBps"))).toBe(true);
  });

  test("deploy review shows the TESTNET chip and a live Soroswap quote for a swap flow", async ({
    page,
    request,
  }) => {
    const res = await request.patch(`/api/flows/${flowId}`, { data: { graph: graph() } });
    expect(res.ok()).toBeTruthy();
    await page.goto(`/flows/${flowId}/deploy`);
    await expect(page.getByTestId("network-chip")).toBeVisible();
    await expect(page.getByTestId("network-chip")).toContainText("TESTNET");
    await expect(page.getByText(/swap XLM to USDC via Soroswap/)).toBeVisible();
    const quote = page.getByTestId("swap-quote");
    await expect(quote).toContainText(/10 XLM → ~\d+\.\d+ USDC via Soroswap \(live\)/, {
      timeout: 30_000,
    });
    await expect(quote).toContainText(/Minimum at 1% slippage: ~\d+\.\d+ USDC/);
    await page.screenshot({
      path: `${OUT}/07-deploy-review.png`,
      fullPage: true,
      animations: "disabled",
    });
  });

  test("deploy review renders one live quote per Swap node, not just the first", async ({
    page,
    request,
  }) => {
    // XLM → USDC → XLM: each leg's assetIn matches the upstream assetOut, so the
    // chain validates, and the review must show a quote for both legs rather
    // than silently previewing the first only (QA-D1 TC-008 steps 3–5).
    const twoSwaps = {
      nodes: [
        { id: "t", type: "on_receive", config: { asset: XLM } },
        {
          id: "s1",
          type: "swap",
          config: { assetIn: XLM, assetOut: USDC, slippageBps: 100, deadlineSecs: 300 },
        },
        {
          id: "s2",
          type: "swap",
          config: { assetIn: USDC, assetOut: XLM, slippageBps: 200, deadlineSecs: 300 },
        },
        {
          id: "p",
          type: "pay",
          config: {
            recipient: RECIPIENT,
            asset: XLM,
            mode: "fixed",
            amountStroops: "1000000",
            fullAmount: true,
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "s1" },
        { id: "e2", source: "s1", target: "s2" },
        { id: "e3", source: "s2", target: "p" },
      ],
      positions: {
        t: { x: 40, y: 120 },
        s1: { x: 360, y: 120 },
        s2: { x: 680, y: 120 },
        p: { x: 1000, y: 120 },
      },
    };
    const res = await request.patch(`/api/flows/${flowId}`, { data: { graph: twoSwaps } });
    expect(res.ok(), await res.text()).toBeTruthy();
    await page.goto(`/flows/${flowId}/deploy`);
    await expect(page.getByTestId("network-chip")).toContainText("TESTNET");
    const quotes = page.getByTestId("swap-quote");
    await expect(quotes).toHaveCount(2);
    await expect(quotes.nth(0)).toContainText(/10 XLM → ~\d+\.\d+ USDC via Soroswap \(live\)/, {
      timeout: 30_000,
    });
    await expect(quotes.nth(0)).toContainText(/Minimum at 1% slippage/);
    await expect(quotes.nth(1)).toContainText(/10 USDC → ~\d+\.\d+ XLM via Soroswap \(live\)/, {
      timeout: 30_000,
    });
    await expect(quotes.nth(1)).toContainText(/Minimum at 2% slippage/);
  });

  test("the config panel shows the same live quote (#391)", async ({ page, request }) => {
    const res = await request.patch(`/api/flows/${flowId}`, { data: { graph: graph() } });
    expect(res.ok()).toBeTruthy();
    const panel = await openSwapPanel(page, flowId);
    const quote = panel.getByTestId("swap-quote");
    await expect(quote).toContainText(/≈ \d+\.\d+ USDC/, { timeout: 30_000 });
    await expect(quote).toContainText(/for 10 XLM · at least \d+\.\d+ USDC at 1% slippage/);
    await panel.screenshot({ path: `${OUT}/08-swap-panel-live-quote.png`, animations: "disabled" });
    await page.screenshot({ path: `${OUT}/09-builder-live-quote.png`, animations: "disabled" });
  });

  test("the quote endpoint answers with strings and rejects a bad query", async ({ request }) => {
    const ok = await request.get(
      "/api/soroswap/quote?assetIn=native&assetOut=USDC&amountStroops=100000000",
    );
    expect(ok.status()).toBe(200);
    const json = await ok.json();
    expect(typeof json.data.amountOutStroops).toBe("string");
    expect(typeof json.data.amountOutMinStroops).toBe("string");
    expect(BigInt(json.data.amountOutStroops)).toBeGreaterThan(
      BigInt(json.data.amountOutMinStroops),
    );
    const { writeFile } = await import("node:fs/promises");
    await writeFile(`${OUT}/10-quote-endpoint.json`, JSON.stringify(json, null, 2));
    const bad = await request.get(
      "/api/soroswap/quote?assetIn=native&assetOut=native&amountStroops=1",
    );
    expect(bad.status()).toBe(422);
  });
});
