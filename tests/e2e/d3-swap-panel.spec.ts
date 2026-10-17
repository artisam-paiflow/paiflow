/**
 * Instawards D3 (#613) evidence: the config panel container around the Swapper
 * panel — opened, walked and closed from the keyboard, scanned with axe, and
 * docked on the right on desktop and as a bottom sheet on a phone. Writes PNGs into docs/instawards/evidence/d3/.
 *
 * Also measures the editable AddressPicker's controls on the Pay panel (#661):
 * the Swapper renders the pinned branch only, so the 44×44 scan below would
 * never reach the editable one.
 *
 * The slippage floor error (#637) is seeded through the API rather than typed:
 * the shared numeric input clamps every keystroke, so the only way the field
 * is invalid is a graph that arrives that way.
 *
 * Runs on both projects (the per-project suffix keeps their PNGs apart):
 *   PLAYWRIGHT_NO_SERVER=1 ADMIN_SEED_PASSWORD=… pnpm exec playwright test \
 *     tests/e2e/d3-swap-panel.spec.ts
 *
 * The committed PNGs are evidence only when taken from paiflow.xyz (#637),
 * signed in as a disposable sandbox user rather than an admin:
 *   PLAYWRIGHT_BASE_URL=https://paiflow.xyz PLAYWRIGHT_NO_SERVER=1 \
 *     PLAYWRIGHT_SANDBOX=1 pnpm exec playwright test tests/e2e/d3-swap-panel.spec.ts
 * and record the build in 03-18-after-meta.json.
 */
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const OUT = "docs/instawards/evidence/d3";
const RECIPIENT = "GC5Q654OUY2FMR6TVBCTQYNGZLGX4ZCGUJ5XDE2UMBSLYYHTNIN3L6O6";
const XLM = { kind: "native" };
const USDC = { kind: "known", symbol: "USDC" };
// Soroswap's published testnet router; see #636's `pnpm soroswap:check`.
const SOROSWAP_ROUTER_TESTNET = "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD";

// Injected as content: a script `url` is blocked by the app's CSP (lib/csp.ts).
const AXE_SOURCE = readFileSync("node_modules/axe-core/axe.min.js", "utf8");

// The D1 fixture (swap-panel.spec.ts), so the desktop captures line up with
// D1's panel screenshots.
function graph() {
  return {
    nodes: [
      { id: "t", type: "on_receive", config: { asset: XLM } },
      {
        id: "s",
        type: "swap",
        config: { assetIn: XLM, assetOut: USDC, slippageBps: 100, deadlineSecs: 300 },
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
    ],
    edges: [
      { id: "e1", source: "t", target: "s" },
      { id: "e2", source: "s", target: "p" },
    ],
    positions: {
      t: { x: 40, y: 120 },
      s: { x: 360, y: 120 },
      p: { x: 680, y: 120 },
    },
  };
}

const swapNode = (page: Page) => page.locator('.react-flow__node[data-id="s"]');
const container = (page: Page) => page.getByTestId("config-panel-container");

async function gotoBuilder(page: Page, flowId: string) {
  await page.goto(`/flows/${flowId}`);
  await swapNode(page).waitFor({ timeout: 20_000 });
}

/** Where focus is, described by the name a screen reader would read. */
function activeName(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return "";
    const labelled = el.getAttribute("aria-labelledby");
    const byId = labelled
      ?.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    const label = (el as HTMLInputElement).labels?.[0]?.textContent;
    return (el.getAttribute("aria-label") || byId || label || el.textContent || el.tagName)
      .replace(/\s+/g, " ")
      .trim();
  });
}

/**
 * Router and deadline sit in a collapsed Advanced section, which axe skips and
 * the 44px scan sees as zero-size, so both scans open it first.
 */
async function openAdvanced(page: Page) {
  const advanced = container(page).getByTestId("swap-advanced");
  await advanced.evaluate((el) => {
    (el as HTMLDetailsElement).open = true;
  });
  await expect(advanced.getByTestId("swap-router")).toBeVisible();
}

/** Docked settings must stay entirely inside the screen. */
async function assertPanelInViewport(page: Page) {
  const b = (await container(page).boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.y + b.height).toBeLessThanOrEqual(page.viewportSize()!.height);
}

async function axeViolations(page: Page) {
  await openAdvanced(page);
  // page.evaluate runs over CDP, outside the page's CSP.
  await page.evaluate(AXE_SOURCE);
  return page.evaluate(async () => {
    const w = window as unknown as {
      axe: {
        run: (
          ctx: Element,
          opts: object,
        ) => Promise<{
          violations: Array<{ id: string; help: string; nodes: Array<{ target: unknown[] }> }>;
        }>;
      };
    };
    const el = document.querySelector('[data-testid="config-panel-container"]');
    if (!el) throw new Error("config panel is not open");
    const { violations } = await w.axe.run(el, { resultTypes: ["violations"] });
    return violations.map((v) => ({
      id: v.id,
      help: v.help,
      targets: v.nodes.map((n) => n.target.join(" ")),
    }));
  });
}

test.describe("Config panel container (Instawards D3)", () => {
  let flowId!: string;
  let sfx!: string;

  test.beforeAll(async () => {
    await mkdir(OUT, { recursive: true });
  });

  // A flow per test: the builder autosaves, so a test that edits the panel
  // would otherwise leak its edits into the next one.
  test.beforeEach(async ({ page, request, isMobile }, testInfo) => {
    sfx = testInfo.project.name === "mobile" ? "mobile" : "desktop";
    // D1's viewport on desktop; Pixel 7's own on mobile.
    if (!isMobile) await page.setViewportSize({ width: 1440, height: 1600 });
    const res = await request.post("/api/flows", {
      data: { name: "D3 panel evidence", graph: graph() },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    flowId = (await res.json()).data.id;
  });

  test.afterEach(async ({ request }) => {
    if (flowId) await request.delete(`/api/flows/${flowId}`);
  });

  test("keyboard only: open, walk every field, edit, read an error, Escape back to the node", async ({
    page,
    isMobile,
  }) => {
    await gotoBuilder(page, flowId);
    // Reach the canvas by Tab alone: the skip link, then the first node, then
    // the Swap node — each with a visible ring (pair 09's missing node focus).
    const skip = page.getByRole("button", { name: "Skip to canvas" });
    await page.locator("body").focus();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      if (await skip.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator('.react-flow__node[data-id="t"]')).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(swapNode(page)).toBeFocused();
    expect(await swapNode(page).evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe(
      "none",
    );
    await page.keyboard.press("Enter");

    const panel = container(page);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAccessibleName("Swap settings");
    await expect(panel.getByRole("heading", { name: "Swap settings" })).toBeFocused();
    await page.screenshot({
      path: `${OUT}/03-keyboard-open-${sfx}.png`,
      animations: "disabled",
    });

    // Tab through the panel and record the order.
    const order: string[] = [];
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      const inside = await panel.evaluate((el) => el.contains(document.activeElement));
      if (!inside) break;
      order.push(await activeName(page));
    }
    const expected = [
      /^Delete$/,
      /^Close Swap settings$/,
      /Asset In/,
      /Asset Out/,
      /Max slippage/,
      /You send/,
      /Advanced/,
    ];
    let at = 0;
    for (const re of expected) {
      const found = order.findIndex((name, i) => i >= at && re.test(name));
      expect(
        found,
        `${re} after position ${at} in ${JSON.stringify(order)}`,
      ).toBeGreaterThanOrEqual(at);
      at = found + 1;
    }

    // Advanced (router, deadline) opens from the keyboard too.
    const advanced = panel.locator("summary", { hasText: "Advanced" });
    await advanced.focus();
    // Missing local router configuration opens Advanced automatically.
    if (await advanced.evaluate((el) => (el.parentElement as HTMLDetailsElement).open)) {
      await page.keyboard.press("Enter");
    }
    await page.keyboard.press("Enter");
    await expect(panel.getByLabel(/Deadline/)).toBeVisible();
    await expect(panel.getByTestId("swap-router")).toBeVisible();
    // Opening Advanced must keep the dock inside the viewport.
    if (!isMobile) await assertPanelInViewport(page);

    // Edit slippage from the keyboard; the draft commits on blur.
    const slippage = panel.getByLabel(/Max slippage/);
    await slippage.focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("2");
    await page.keyboard.press("Tab");
    // Mobile intentionally collapses the English preview, but its content updates.
    await expect(page.getByTestId("english-preview-text")).toContainText("up to 2% slippage");

    // Trigger a validation error: Asset Out onto the same asset as Asset In
    // (the catalogue lists USDC, then XLM).
    const assetOut = panel.getByLabel("Asset Out");
    await assetOut.focus();
    await page.keyboard.press("ArrowDown");
    await expect(panel.getByText(/two different assets/).first()).toBeVisible();
    const invalid = panel.locator('[aria-invalid="true"]').first();
    await expect(invalid).toBeVisible();
    const described = await invalid.evaluate((el) =>
      (el.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" "),
    );
    expect(described).toMatch(/two different assets/);
    await page.screenshot({
      path: `${OUT}/04-keyboard-error-${sfx}.png`,
      animations: "disabled",
    });

    // Escape from inside a field closes the panel and focus returns to the node.
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(swapNode(page)).toBeFocused();
    expect(await swapNode(page).evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe(
      "none",
    );

    // Enter reopens it; Close does the same as Escape.
    await page.keyboard.press("Enter");
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Close Swap settings" }).press("Enter");
    await expect(panel).toHaveCount(0);
    await expect(swapNode(page)).toBeFocused();
  });

  test("settings scroll with a fixed header, switch nodes, and close on blank canvas", async ({
    page,
    isMobile,
  }) => {
    if (!isMobile) await page.setViewportSize({ width: 1440, height: 700 });
    await gotoBuilder(page, flowId);
    await swapNode(page).click();
    const panel = container(page);
    await openAdvanced(page);
    const heading = panel.getByRole("heading", { name: "Swap settings" });
    const before = (await heading.boundingBox())!;
    const body = panel.locator(".overflow-y-auto").first();
    expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await body.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(panel.getByLabel(/Deadline/)).toBeInViewport();
    expect((await heading.boundingBox())!.y).toBeCloseTo(before.y, 0);
    await heading.click();
    await expect(panel).toBeVisible();

    // A different node updates the existing dock, rather than dismissing it.
    const trigger = page.locator('.react-flow__node[data-id="t"]');
    if (isMobile) {
      // The bottom sheet can cover nodes; keyboard selection still switches settings.
      await trigger.focus();
      await page.keyboard.press("Enter");
    } else {
      await trigger.click();
    }
    await expect(panel).toHaveAccessibleName("On Receive settings");
    if (isMobile)
      await expect(panel.getByRole("heading", { name: "On Receive settings" })).toBeFocused();
    const pane = page.locator(".react-flow__pane");
    const blank = await pane.evaluate((el) => {
      const b = el.getBoundingClientRect();
      for (let y = b.top + 60; y < b.bottom - 10; y += 25) {
        for (let x = b.left + 60; x < b.right - 10; x += 25) {
          if (document.elementFromPoint(x, y) === el) return { x, y };
        }
      }
      throw new Error("No blank canvas point found");
    });
    if (isMobile) await page.touchscreen.tap(blank.x, blank.y);
    else await page.mouse.click(blank.x, blank.y);
    await expect(panel).toHaveCount(0);
  });

  test("axe finds no violations in the panel", async ({ page }) => {
    await gotoBuilder(page, flowId);
    await swapNode(page).click();
    await expect(container(page)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test("axe finds no violations in the panel's error state", async ({ page, request }) => {
    // Patched before the first page load: the builder autosaves what it
    // loaded, which would race a patch made after it.
    const bad = graph();
    bad.nodes[1]!.config = { ...bad.nodes[1]!.config, assetOut: XLM } as never;
    const res = await request.patch(`/api/flows/${flowId}`, { data: { graph: bad } });
    expect(res.ok(), await res.text()).toBeTruthy();
    await gotoBuilder(page, flowId);
    await swapNode(page).click();
    await expect(
      container(page)
        .getByText(/two different assets/)
        .first(),
    ).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  // The 0.3% slippage floor (lib/flows/swap-rules.ts:109) is the one rule the
  // shared numeric input can show an error for, and `useDraftNumber` refuses a
  // below-minimum draft on every keystroke and raises it on blur, so the field
  // is only invalid when the graph arrives that way — a flow saved before the
  // rule. Patched before the first load, like the same-asset case above.
  test("the slippage floor error reaches the shared input", async ({ page, request, isMobile }) => {
    const bad = graph();
    bad.nodes[1]!.config = { ...bad.nodes[1]!.config, slippageBps: 10 } as never;
    const res = await request.patch(`/api/flows/${flowId}`, { data: { graph: bad } });
    expect(res.ok(), await res.text()).toBeTruthy();

    await gotoBuilder(page, flowId);
    await swapNode(page).click();
    const panel = container(page);
    await expect(panel).toHaveAccessibleName("Swap settings");

    const slippage = panel.getByLabel(/Max slippage/);
    await expect(slippage).toHaveAttribute("aria-invalid", "true");
    const described = await slippage.evaluate((el) =>
      (el.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" "),
    );
    expect(described).toMatch(/pool fee is 0\.3%/);

    if (!isMobile) await assertPanelInViewport(page);

    const message = panel.getByText(/makes every swap revert/);
    await expect(message).toBeVisible();
    // Scroll the mobile sheet to reveal the message.
    if (isMobile) await message.scrollIntoViewIfNeeded();

    // Keep the desktop page context in the historical evidence capture.
    const shot = { path: `${OUT}/15-slippage-error-${sfx}.png`, animations: "disabled" } as const;
    await (isMobile ? panel.screenshot(shot) : page.screenshot(shot));

    expect(await axeViolations(page)).toEqual([]);
  });

  // Retain the existing framing for historical evidence captures.
  async function panelShot(page: Page, isMobile: boolean, path: string) {
    const panel = container(page);
    if (isMobile) return panel.screenshot({ path, animations: "disabled" });
    const clip = (await panel.boundingBox())!;
    return page.screenshot({ path, clip, animations: "disabled" });
  }

  test("Advanced shows the pinned Soroswap router, with copy and explorer link", async ({
    page,
    isMobile,
  }) => {
    await gotoBuilder(page, flowId);
    await swapNode(page).click();
    const panel = container(page);
    await expect(panel).toHaveAccessibleName("Swap settings");
    await openAdvanced(page);

    const router = panel.getByTestId("swap-router");
    await expect(router.locator("output")).toHaveAttribute("title", SOROSWAP_ROUTER_TESTNET);
    await expect(router.getByRole("button", { name: /^Copy Router/ })).toBeVisible();
    await expect(router.getByRole("link", { name: /on stellar\.expert/ })).toHaveAttribute(
      "href",
      new RegExp(`/testnet/contract/${SOROSWAP_ROUTER_TESTNET}$`),
    );

    // The live Soroswap quote, so the ticket is not an empty skeleton.
    await expect(panel.getByTestId("swap-quote")).not.toHaveAttribute("aria-busy", "true");
    if (isMobile) await panel.getByLabel(/Deadline/).scrollIntoViewIfNeeded();
    else await assertPanelInViewport(page);
    await panelShot(page, isMobile, `${OUT}/16-swap-panel-advanced-after-${sfx}.png`);
  });

  // Contrast for D3's later-phase argument: Pay still renders the legacy
  // `AssetField` select, payout-mode select and bare checkbox beside the
  // migrated AddressPicker.
  test("the Pay panel, not yet on the shared inputs", async ({ page, isMobile }) => {
    await gotoBuilder(page, flowId);
    await page.locator('.react-flow__node[data-id="p"]').click();
    await expect(container(page)).toHaveAccessibleName("Pay settings");
    await panelShot(page, isMobile, `${OUT}/18-pay-panel-legacy-${sfx}.png`);
  });

  test("with reduced motion the panel has no transform transition", async ({ page, isMobile }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoBuilder(page, flowId);
    await swapNode(page).click();
    const panel = container(page);
    await expect(panel).toBeVisible();
    // Docked settings do not animate with the canvas or AI chat.
    const target = panel;
    const transition = () =>
      target.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { property: cs.transitionProperty, duration: cs.transitionDuration };
      });
    const reduced = await transition();
    expect(
      reduced.property === "none" || /^0s(, 0s)*$/.test(reduced.duration),
      JSON.stringify(reduced),
    ).toBe(true);
    // The packet that travels along each edge stops too (#647).
    const packet = page.locator('.react-flow__edge[data-id="e1"] path.edge-packet');
    const packetAnimation = () => packet.evaluate((el) => getComputedStyle(el).animationName);
    expect(await packetAnimation()).toBe("none");

    // And the rules are what remove it: without the preference it animates.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    expect(await packetAnimation()).toBe("flow-dash");
  });

  test.describe("desktop docked settings", () => {
    test.skip(({ isMobile }) => isMobile, "the right panel is the desktop layout");

    test("a click opens docked settings without taking focus; zoom preserves their size", async ({
      page,
    }) => {
      await gotoBuilder(page, flowId);
      const node = swapNode(page);
      await node.click();
      const panel = container(page);
      await expect(panel).toBeVisible();
      expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(false);
      await expect(page.getByTestId("config-panel")).toBeVisible();
      await expect(panel.getByTestId("swap-quote")).not.toHaveAttribute("aria-busy", "true");

      expect(await panel.evaluate((el) => !!el.closest(".react-flow"))).toBe(false);
      await assertPanelInViewport(page);
      const before = (await panel.boundingBox())!;
      await page.locator(".react-flow__controls-zoomin").click();
      const after = (await panel.boundingBox())!;
      expect(after.width).toBeCloseTo(before.width, 0);
      expect(after.x).toBeCloseTo(before.x, 0);
      const canvas = (await page.locator(".react-flow").boundingBox())!;
      expect(canvas.x + canvas.width).toBeCloseTo(page.viewportSize()!.width, 0);
      expect(before.y).toBe(64);
      expect(before.y + before.height).toBeCloseTo(page.viewportSize()!.height, 0);
      const preview = (await page.getByTestId("english-preview-text").boundingBox())!;
      expect(before.y).toBeLessThan(preview.y);
      expect(before.x).toBeLessThan(preview.x + preview.width);

      // Arrow keys move the clicked node, and Delete removes it.
      await node.click();
      const pos = (await node.boundingBox())!;
      await page.keyboard.press("ArrowRight");
      await expect.poll(async () => (await node.boundingBox())!.x).toBeGreaterThan(pos.x);
      await page.keyboard.press("Delete");
      await expect(node).toHaveCount(0);
      await expect(panel).toHaveCount(0);
    });

    test("AI chat and settings share the right side", async ({ page }) => {
      await gotoBuilder(page, flowId);
      const openChat = page.getByTitle("Open AI chat");
      await openChat.click();
      await expect(page.locator("#ai-panel")).not.toHaveClass(/translate-x-full/);
      await swapNode(page).focus();
      await page.keyboard.press("Enter");
      await expect(container(page)).toBeVisible();
      await expect(page.locator("#ai-panel")).toHaveClass(/translate-x-full/);
      await expect(openChat).toHaveCount(0);
      await container(page).getByRole("button", { name: "Close Swap settings" }).click();
      await openChat.click();
      await expect(container(page)).toHaveCount(0);
      await expect(page.locator("#ai-panel")).not.toHaveClass(/translate-x-full/);
    });

    test("dragging a node neither opens its panel nor closes an open one", async ({ page }) => {
      await gotoBuilder(page, flowId);
      const drag = async (node: ReturnType<Page["locator"]>) => {
        const b = (await node.boundingBox())!;
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2 + 120, b.y + b.height / 2 + 60, { steps: 8 });
        await page.mouse.up();
        await expect.poll(async () => (await node.boundingBox())!.x).toBeGreaterThan(b.x + 100);
      };

      await drag(swapNode(page));
      await expect(container(page)).toHaveCount(0);

      await page.locator('.react-flow__node[data-id="p"]').click();
      await expect(container(page)).toBeVisible();
      await drag(page.locator('.react-flow__node[data-id="t"]'));
      await expect(container(page)).toHaveAccessibleName("Pay settings");
    });
  });

  test.describe("phone", () => {
    test.skip(({ isMobile }) => !isMobile, "the docked sheet is the small-screen layout");

    test("the panel is a docked sheet that scrolls and closes", async ({ page }) => {
      await gotoBuilder(page, flowId);
      await swapNode(page).tap();
      const panel = container(page);
      await expect(panel).toBeVisible();
      await expect(panel.getByTestId("swap-quote")).not.toHaveAttribute("aria-busy", "true");

      const layout = await panel.evaluate((el) => ({
        inViewport: !!el.closest(".react-flow__viewport"),
        position: getComputedStyle(el).position,
        height: el.getBoundingClientRect().height,
        bottom: el.getBoundingClientRect().bottom,
        innerHeight: window.innerHeight,
      }));
      expect(layout.inViewport).toBe(false);
      expect(layout.position).toBe("fixed");
      expect(layout.height).toBeLessThanOrEqual(layout.innerHeight * 0.6 + 1);
      expect(Math.abs(layout.bottom - layout.innerHeight)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `${OUT}/07-docked-sheet-mobile.png`, animations: "disabled" });

      const body = panel.locator(".overflow-y-auto").first();
      const scrolled = await body.evaluate((el) => {
        const scrollable = el.scrollHeight > el.clientHeight;
        el.scrollTop = el.scrollHeight;
        return { scrollable, top: el.scrollTop };
      });
      expect(scrolled.scrollable).toBe(true);
      expect(scrolled.top).toBeGreaterThan(0);
      await page.screenshot({
        path: `${OUT}/08-docked-sheet-scrolled-mobile.png`,
        animations: "disabled",
      });

      await panel.getByRole("button", { name: "Close Swap settings" }).tap();
      await expect(panel).toHaveCount(0);
    });

    test("the sheet and the chat are never shown together", async ({ page }) => {
      await gotoBuilder(page, flowId);
      await swapNode(page).tap();
      const panel = container(page);
      await expect(panel).toBeVisible();

      // The sheet covers the Ask AI button's corner, so the button steps out
      // rather than sit focusable but unseen beneath it.
      const openChat = page.getByTitle("Open AI chat");
      await expect(openChat).toHaveCount(0);

      await panel.getByRole("button", { name: "Close Swap settings" }).tap();
      await expect(panel).toHaveCount(0);
      await openChat.tap();
      await expect(page.locator("#ai-panel")).not.toHaveClass(/translate-x-full/);

      // The full-width chat covers the canvas, so the node is reached by keyboard.
      await swapNode(page).focus();
      await page.keyboard.press("Enter");
      await expect(container(page)).toBeVisible();
      await expect(page.locator("#ai-panel")).toHaveClass(/translate-x-full/);
      await expect(openChat).toHaveCount(0);

      await container(page).getByRole("button", { name: "Close Swap settings" }).tap();
      await expect(openChat).toBeVisible();
    });

    // The scan is scoped to the panel container, so the listbox `AddressPicker`
    // portals to <body> is out of reach; the controls inside the panel itself
    // are what it covers.
    async function tooSmall(page: Page) {
      const panel = container(page);
      await expect(panel).toBeVisible();
      await openAdvanced(page);
      return panel.evaluate((root) =>
        Array.from(
          root.querySelectorAll<HTMLElement>(
            'button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
          ),
        )
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              el: `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}"`,
              w: Math.round(r.width),
              h: Math.round(r.height),
            };
          })
          .filter((t) => t.w > 0 && t.h > 0 && (t.w < 44 || t.h < 44)),
      );
    }

    test("every interactive element in the panel is at least 44×44 CSS px", async ({ page }) => {
      await gotoBuilder(page, flowId);
      await swapNode(page).tap();
      expect(await tooSmall(page)).toEqual([]);
    });

    // The Swapper renders `AddressPicker` in pinned mode only, so the editable
    // branch every other panel gets was never measured — which is how #661's
    // 18px save button survived. Pay is the nearest non-swap caller.
    //
    // Scoped to the picker's own controls rather than the whole panel: Pay
    // still renders the legacy `AssetField` select, the payout-mode select and
    // a bare checkbox, all under 44px. Those are the unmigrated inputs #607
    // deliberately left untouched (SOW l.262-263) and are tracked separately.
    test("the editable AddressPicker's controls are at least 44×44 CSS px", async ({ page }) => {
      await gotoBuilder(page, flowId);
      await page.locator('.react-flow__node[data-id="p"]').tap();
      await expect(container(page)).toHaveAccessibleName("Pay settings");

      const input = page.getByRole("combobox", { name: /Recipient/ });
      await input.fill(RECIPIENT);
      const save = page.getByRole("button", { name: "Save to address book" });
      await expect(save).toBeVisible();

      const inputBox = (await input.boundingBox())!;
      const saveBox = (await save.boundingBox())!;
      expect({ w: Math.round(saveBox.width), h: Math.round(saveBox.height) }).toEqual({
        w: 44,
        h: 44,
      });
      // The target must sit in the gutter `pointer-coarse:pr-14` reserves, not
      // over the address the user is typing.
      expect(saveBox.x).toBeGreaterThanOrEqual(inputBox.x + inputBox.width - 56);
      expect(Math.round(inputBox.height)).toBeGreaterThanOrEqual(44);
    });
  });
});
