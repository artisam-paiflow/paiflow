/**
 * Instawards D3 (#613) evidence: the config panel container around the Swapper
 * panel — opened, walked and closed from the keyboard, scanned with axe, and
 * docked as a bottom sheet on a phone — with the desktop mouse behaviour
 * asserted unchanged. Writes PNGs into docs/instawards/evidence/d3/.
 *
 * Also measures the editable AddressPicker's controls on the Pay panel (#661):
 * the Swapper renders the pinned branch only, so the 44×44 scan below would
 * never reach the editable one.
 *
 * Runs on both projects (the per-project suffix keeps their PNGs apart):
 *   PLAYWRIGHT_NO_SERVER=1 ADMIN_SEED_PASSWORD=… pnpm exec playwright test \
 *     tests/e2e/d3-swap-panel.spec.ts
 */
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const OUT = "docs/instawards/evidence/d3";
const RECIPIENT = "GC5Q654OUY2FMR6TVBCTQYNGZLGX4ZCGUJ5XDE2UMBSLYYHTNIN3L6O6";
const XLM = { kind: "native" };
const USDC = { kind: "known", symbol: "USDC" };

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

async function axeViolations(page: Page) {
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
  }) => {
    await gotoBuilder(page, flowId);
    await swapNode(page).focus();
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
      /Deadline/,
      /Preview amount/,
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

    // Edit slippage from the keyboard; the draft commits on blur.
    const slippage = panel.getByLabel(/Max slippage/);
    await slippage.focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("2");
    await page.keyboard.press("Tab");
    await expect(page.getByText(/up to 2% slippage/)).toBeVisible();

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

    // Enter reopens it; Close does the same as Escape.
    await page.keyboard.press("Enter");
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Close Swap settings" }).press("Enter");
    await expect(panel).toHaveCount(0);
    await expect(swapNode(page)).toBeFocused();
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

  test("with reduced motion the panel has no transform transition", async ({ page, isMobile }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoBuilder(page, flowId);
    await swapNode(page).click();
    const panel = container(page);
    await expect(panel).toBeVisible();
    // Desktop animates the chat-shift on the card; the docked sheet has none.
    const target = isMobile ? panel : panel.locator(".config-panel-card");
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
    if (!isMobile) {
      expect((await transition()).property).toMatch(/transform/);
    }
  });

  test.describe("desktop mouse behaviour is unchanged", () => {
    test.skip(({ isMobile }) => isMobile, "the floating panel is the desktop layout");

    test("a click opens the floating panel without taking focus; arrows move and Delete removes the node", async ({
      page,
    }) => {
      await gotoBuilder(page, flowId);
      const node = swapNode(page);
      await node.click();
      const panel = container(page);
      await expect(panel).toBeVisible();
      expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(false);
      await expect(page.getByTestId("config-panel")).toBeVisible();

      // Still in flow space: inside the viewport, and it zooms with the canvas.
      expect(await panel.evaluate((el) => !!el.closest(".react-flow__viewport"))).toBe(true);
      await page.screenshot({ path: `${OUT}/05-builder-after.png`, animations: "disabled" });
      await page.getByTestId("config-panel").screenshot({
        path: `${OUT}/06-swap-panel-after.png`,
        animations: "disabled",
      });

      const before = (await panel.boundingBox())!;
      await page.locator(".react-flow__controls-zoomin").click();
      await expect
        .poll(async () => (await panel.boundingBox())!.width)
        .toBeGreaterThan(before.width + 1);

      // The header still drags it.
      const header = panel.getByRole("heading", { name: "Swap settings" });
      const start = (await panel.boundingBox())!;
      const h = (await header.boundingBox())!;
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      await page.mouse.move(h.x + h.width / 2 + 120, h.y + h.height / 2 + 60, { steps: 8 });
      await page.mouse.up();
      const moved = (await panel.boundingBox())!;
      expect(moved.x - start.x).toBeGreaterThan(100);
      expect(moved.y - start.y).toBeGreaterThan(40);

      // Arrow keys move the clicked node, and Delete removes it.
      await node.click();
      const pos = (await node.boundingBox())!;
      await page.keyboard.press("ArrowRight");
      await expect.poll(async () => (await node.boundingBox())!.x).toBeGreaterThan(pos.x);
      await page.keyboard.press("Delete");
      await expect(node).toHaveCount(0);
      await expect(panel).toHaveCount(0);
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
      await expect(container(page)).toBeVisible();

      const openChat = page.getByTitle("Open AI chat");
      await openChat.tap();
      await expect(container(page)).toHaveCount(0);
      await expect(page.locator("#ai-panel")).not.toHaveClass(/translate-x-full/);

      // The full-width chat covers the canvas, so the node is reached by keyboard.
      await swapNode(page).focus();
      await page.keyboard.press("Enter");
      await expect(container(page)).toBeVisible();
      await expect(page.locator("#ai-panel")).toHaveClass(/translate-x-full/);
      await expect(openChat).toBeVisible();
    });

    // The scan is scoped to the panel container, so the listbox `AddressPicker`
    // portals to <body> is out of reach; the controls inside the panel itself
    // are what it covers.
    async function tooSmall(page: Page) {
      const panel = container(page);
      await expect(panel).toBeVisible();
      return panel.evaluate((root) =>
        Array.from(
          root.querySelectorAll<HTMLElement>(
            'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
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
