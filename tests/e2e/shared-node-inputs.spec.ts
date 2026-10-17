import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { FlowGraph, FlowNode } from "@/lib/flows/schema";

const RECIPIENT = "GC5Q654OUY2FMR6TVBCTQYNGZLGX4ZCGUJ5XDE2UMBSLYYHTNIN3L6O6";
const OTHER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const XLM = { kind: "native" } as const;
const trigger: FlowNode = { id: "t", type: "on_receive", config: { asset: XLM } };
const pay: FlowNode = {
  id: "p",
  type: "pay",
  config: {
    asset: XLM,
    recipient: RECIPIENT,
    mode: "fixed",
    amountStroops: "10000000",
    fullAmount: false,
  },
};
function graph(t: FlowNode = trigger, action: FlowNode = pay): FlowGraph {
  return {
    nodes: [t, action],
    edges: [{ id: "e", source: t.id, target: action.id }],
    positions: { [t.id]: { x: 40, y: 120 }, [action.id]: { x: 360, y: 120 } },
  };
}
const panel = (page: Page) => page.getByTestId("config-panel-container");
async function open(page: Page, flowId: string, nodeId: string) {
  await page.goto(`/flows/${flowId}`);
  const node = page.locator(`.react-flow__node[data-id="${nodeId}"]`);
  await node.focus();
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeVisible();
}
async function config(request: APIRequestContext, flowId: string, id: string) {
  const response = await request.get(`/api/flows/${flowId}`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { data: { graph: FlowGraph } };
  return body.data.graph.nodes.find((n) => n.id === id)!.config;
}

test.describe("Shared inputs on available builder nodes", () => {
  let flowId: string;
  test.beforeEach(async ({ request }) => {
    const response = await request.post("/api/flows", {
      data: { name: "Shared input browser check", graph: graph() },
    });
    expect(response.ok(), await response.text()).toBe(true);
    flowId = (await response.json()).data.id;
  });
  test.afterEach(async ({ page, request }) => {
    // Unmount the autosave coordinator before deleting this disposable fixture.
    await page.goto("/dashboard");
    const response = await request.delete(`/api/flows/${flowId}`, {
      data: { confirmation: "Permanently delete flow" },
    });
    expect(response.ok(), await response.text()).toBe(true);
  });
  async function replace(request: APIRequestContext, next: FlowGraph) {
    const response = await request.patch(`/api/flows/${flowId}`, { data: { graph: next } });
    expect(response.ok(), await response.text()).toBe(true);
  }

  test("On Receive keeps amount clearing and exact decimals", async ({ page, request }) => {
    await open(page, flowId, "t");
    const input = panel(page).getByRole("textbox", { name: /Minimum amount/ });
    await input.fill("1.5");
    await input.blur();
    await expect
      .poll(() => config(request, flowId, "t"))
      .toMatchObject({ minAmountStroops: "15000000" });
    await input.clear();
    await input.blur();
    await expect.poll(() => config(request, flowId, "t")).toMatchObject({ minAmountStroops: "0" });
  });

  test("Pay keeps fixed amounts, full payment, and clear-to-unset percentages", async ({
    page,
    request,
  }) => {
    await open(page, flowId, "p");
    const recipient = panel(page).getByRole("combobox", { name: /Recipient \(G/ });
    await recipient.fill(OTHER);
    await recipient.press("Tab");
    const amount = panel(page).getByRole("textbox", { name: /^Amount \(/ });
    await amount.fill("1.5");
    await amount.blur();
    await expect
      .poll(() => config(request, flowId, "p"))
      .toMatchObject({ recipient: OTHER, amountStroops: "15000000" });
    await panel(page)
      .getByRole("combobox", { name: "Mode", exact: true })
      .selectOption("percentage");
    const percentage = panel(page).getByRole("spinbutton", { name: "Percentage" });
    await percentage.fill("12.3456");
    await percentage.blur();
    await expect.poll(() => config(request, flowId, "p")).toMatchObject({ percentage: 12.3456 });
    await percentage.clear();
    await percentage.blur();
    await expect.poll(async () => "percentage" in (await config(request, flowId, "p"))).toBe(false);
    await expect(percentage).toHaveAttribute("aria-invalid", "true");
    await panel(page).getByRole("checkbox", { name: "Send full amount" }).check();
    await expect
      .poll(() => config(request, flowId, "p"))
      .toMatchObject({ fullAmount: true, percentage: 100 });
  });

  test("Split keeps shares and fixed amounts when switching modes", async ({ page, request }) => {
    const split: FlowNode = {
      id: "s",
      type: "split",
      config: {
        asset: XLM,
        recipients: [
          { address: RECIPIENT, label: "Alice", mode: "percentage", bps: 5000 },
          { address: OTHER, label: "Bob", mode: "percentage", bps: 5000 },
        ],
      },
    };
    await replace(request, graph(trigger, split));
    await open(page, flowId, "s");
    const share = panel(page).getByRole("textbox", { name: "Share for Alice" });
    await share.clear();
    await share.blur();
    await expect
      .poll(() => config(request, flowId, "s"))
      .toMatchObject({ recipients: [{ bps: 5000 }, { bps: 5000 }] });
    await share.fill("12.5");
    await share.blur();
    await expect
      .poll(() => config(request, flowId, "s"))
      .toMatchObject({ recipients: [{ bps: 1250 }, { bps: 5000 }] });
    const mode = panel(page).getByRole("combobox", { name: "Distribution mode" });
    await mode.selectOption("fixed");
    await panel(page).getByRole("textbox", { name: "Amount for Alice" }).fill("1.5");
    await panel(page).getByRole("textbox", { name: "Amount for Bob" }).fill("2");
    await mode.focus();
    await expect
      .poll(() => config(request, flowId, "s"))
      .toMatchObject({
        recipients: [{ amountStroops: "15000000" }, { amountStroops: "20000000" }],
      });
    await mode.selectOption("percentage");
    await expect(share).toHaveValue("12.5");
    await mode.selectOption("fixed");
    await expect(panel(page).getByRole("textbox", { name: "Amount for Alice" })).toHaveValue("1.5");
  });

  test("On Schedule preserves timezone edits and optional end/count behavior", async ({
    page,
    request,
  }) => {
    const scheduled: FlowNode = {
      id: "t",
      type: "on_schedule",
      config: {
        intervalAmount: 1,
        intervalUnit: "day",
        startsAt: "2030-01-01T00:00:00.000Z",
        timeZone: "UTC",
        pauseAllowed: true,
        retrieveAllowed: false,
      },
    };
    await replace(request, graph(scheduled));
    await open(page, flowId, "t");
    await panel(page).getByRole("combobox", { name: "Timezone" }).selectOption("Asia/Hong_Kong");
    await expect
      .poll(() => config(request, flowId, "t"))
      .toMatchObject({ startsAt: "2029-12-31T16:00:00.000Z", timeZone: "Asia/Hong_Kong" });
    const occurrences = panel(page).getByRole("spinbutton", { name: "Occurrences — optional" });
    await occurrences.fill("5");
    await occurrences.blur();
    await expect.poll(() => config(request, flowId, "t")).toMatchObject({ occurrences: 5 });
    const end = panel(page).getByLabel("Ends at — optional", { exact: true });
    await end.fill("2030-02-01T00:00");
    await end.blur();
    await expect
      .poll(async () => "occurrences" in (await config(request, flowId, "t")))
      .toBe(false);
    await end.clear();
    await end.blur();
    await expect.poll(async () => "endsAt" in (await config(request, flowId, "t"))).toBe(false);
  });

  test("Subscription retains address, amount, and interval editing", async ({ page, request }) => {
    const subscription: FlowNode = {
      id: "t",
      type: "subscription",
      config: {
        asset: XLM,
        subscriber: RECIPIENT,
        amountPerPeriodStroops: "10000000",
        intervalAmount: 1,
        intervalUnit: "day",
      },
    };
    await replace(request, graph(subscription));
    await open(page, flowId, "t");
    const subscriber = panel(page).getByRole("combobox", { name: /Subscriber address/ });
    await subscriber.fill(OTHER);
    await subscriber.press("Tab");
    const amount = panel(page).getByRole("textbox", { name: /Amount per period/ });
    await amount.fill("1.5");
    await amount.blur();
    await panel(page).getByRole("spinbutton", { name: "Number", exact: true }).fill("3");
    await panel(page).getByRole("combobox", { name: "Unit", exact: true }).selectOption("week");
    await expect
      .poll(() => config(request, flowId, "t"))
      .toMatchObject({
        subscriber: OTHER,
        amountPerPeriodStroops: "15000000",
        intervalAmount: 3,
        intervalUnit: "week",
      });
  });

  test("HTTP Webhook uses shared asset selection", async ({ page, request }) => {
    await replace(request, graph({ id: "t", type: "web2_webhook", config: { asset: XLM } }));
    await open(page, flowId, "t");
    await panel(page)
      .getByRole("combobox", { name: "Asset", exact: true })
      .selectOption("known:USDC");
    await expect
      .poll(() => config(request, flowId, "t"))
      .toMatchObject({ asset: { kind: "known", symbol: "USDC" } });
  });

  test("Condition retains amount and time configuration", async ({ page, request }) => {
    const condition: FlowNode = {
      id: "c",
      type: "condition",
      config: { kind: "amount_gt", amountStroops: "10000000" },
    };
    const next = graph();
    next.nodes.push(condition, { ...pay, id: "p2" });
    next.edges = [
      { id: "e1", source: "t", target: "c" },
      { id: "e2", source: "c", target: "p", sourceHandle: "true" },
      { id: "e3", source: "c", target: "p2", sourceHandle: "false" },
    ];
    next.positions = {
      t: { x: 0, y: 0 },
      c: { x: 240, y: 0 },
      p: { x: 480, y: 0 },
      p2: { x: 480, y: 200 },
    };
    await replace(request, next);
    await open(page, flowId, "c");
    const amount = panel(page).getByRole("textbox", { name: "Threshold", exact: true });
    await amount.fill("1.5");
    await amount.blur();
    await expect
      .poll(() => config(request, flowId, "c"))
      .toMatchObject({ kind: "amount_gt", amountStroops: "15000000" });
    await panel(page).getByRole("combobox", { name: "Condition kind" }).selectOption("time_after");
    await panel(page).getByRole("combobox", { name: "Timezone" }).selectOption("UTC");
    await panel(page).getByLabel("Date & time", { exact: true }).fill("2030-01-01T12:00");
    await panel(page).getByLabel("Date & time", { exact: true }).blur();
    await expect
      .poll(() => config(request, flowId, "c"))
      .toMatchObject({ kind: "time_after", at: "2030-01-01T12:00:00.000Z", timeZone: "UTC" });
  });
});
