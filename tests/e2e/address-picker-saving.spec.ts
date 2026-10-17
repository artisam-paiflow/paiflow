import { expect, test, type Page } from "@playwright/test";

const WALLET = "GC5Q654OUY2FMR6TVBCTQYNGZLGX4ZCGUJ5XDE2UMBSLYYHTNIN3L6O6";
const OTHER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
type Contact = { label: string; address: string };
const fixture = {
  nodes: [
    { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
    {
      id: "p",
      type: "pay",
      config: {
        asset: { kind: "native" },
        recipient: WALLET,
        mode: "fixed",
        amountStroops: "10000000",
        fullAmount: false,
      },
    },
  ],
  edges: [{ id: "e", source: "t", target: "p" }],
  positions: { t: { x: 40, y: 120 }, p: { x: 360, y: 120 } },
};
const panel = (page: Page) => page.getByTestId("config-panel-container");
const wallet = (page: Page) => panel(page).getByRole("combobox", { name: /Recipient/ });
const save = (page: Page) => panel(page).getByRole("button", { name: "Save contact", exact: true });
const contactName = (page: Page) => panel(page).getByRole("textbox", { name: "Contact name" });

test.describe("Inline contact saving", () => {
  let flowId: string;
  test.beforeEach(async ({ request }) => {
    const response = await request.post("/api/flows", {
      data: { name: "Contact saving UX check", graph: fixture },
    });
    expect(response.ok(), await response.text()).toBe(true);
    flowId = (await response.json()).data.id;
  });
  test.afterEach(async ({ page, request }) => {
    await page.goto("/dashboard");
    const response = await request.delete(`/api/flows/${flowId}`, {
      data: { confirmation: "Permanently delete flow" },
    });
    expect(response.ok(), await response.text()).toBe(true);
  });
  async function open(page: Page) {
    await page.goto(`/flows/${flowId}`);
    const node = page.locator('.react-flow__node[data-id="p"]');
    await node.focus();
    await page.keyboard.press("Enter");
    await expect(panel(page)).toHaveAccessibleName("Pay settings");
  }

  test("editing a wallet keeps the field and validation within the panel", async ({ page }) => {
    await page.route("**/api/address-book", (route) => route.fulfill({ json: { data: [] } }));
    await open(page);
    const initial = (await wallet(page).boundingBox())!;
    await wallet(page).focus();
    await wallet(page).press("End");
    await wallet(page).press("Backspace");
    await expect(wallet(page)).toHaveAttribute("aria-invalid", "true");
    const edited = (await wallet(page).boundingBox())!;
    expect(Math.abs(edited.width - initial.width)).toBeLessThan(1);
    const errorId = await wallet(page).getAttribute("aria-describedby");
    const error = page.locator(`[id="${errorId!.split(" ").at(-1)}"]`);
    await expect(error).toContainText("Enter a complete wallet address");
    expect(await error.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(
      await panel(page).evaluate((el) =>
        [...el.querySelectorAll("*")].every(
          (child) => child.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1,
        ),
      ),
    ).toBe(true);
  });

  for (const populated of [false, true]) {
    test(`save is discoverable with ${populated ? "existing" : "no"} contacts`, async ({
      page,
      request,
    }, testInfo) => {
      let contacts: Contact[] = populated ? [{ label: "Bob", address: OTHER }] : [];
      const writes: unknown[] = [];
      // Contact writes are intercepted: these checks never change the user's address book.
      await page.route("**/api/address-book", async (route) => {
        if (route.request().method() === "POST") {
          const body = route.request().postDataJSON() as {
            label: string;
            address: string;
            createOnly: boolean;
          };
          writes.push(body);
          contacts = [...contacts, { label: body.label, address: body.address }];
          await route.fulfill({ json: { data: body } });
        } else await route.fulfill({ json: { data: contacts } });
      });
      await open(page);
      await wallet(page).click();
      await expect(wallet(page)).toBeFocused();
      await expect(save(page)).toBeVisible();
      const inputBox = (await wallet(page).boundingBox())!;
      const actionBox = (await save(page).boundingBox())!;
      expect(actionBox.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height);
      expect(actionBox.height).toBeGreaterThanOrEqual(44);
      expect(await save(page).evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("solid");
      await save(page).click();
      await expect(contactName(page)).toBeFocused();
      await expect(panel(page).getByText(WALLET, { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(panel(page)).toBeVisible();
      await expect(contactName(page)).toHaveCount(0);
      await expect(wallet(page)).toBeFocused();
      await save(page).click();
      await contactName(page).fill("Carol");
      await panel(page).screenshot({
        path: testInfo.outputPath("inline-contact-form.png"),
        animations: "disabled",
      });
      await contactName(page).press("Enter");
      await expect(
        panel(page).getByRole("status").filter({ hasText: "Saved as Carol" }),
      ).toBeVisible();
      expect(writes).toEqual([{ label: "Carol", address: WALLET, createOnly: true }]);
      await expect(save(page)).toHaveCount(0);
      await expect(wallet(page)).toHaveValue(WALLET);
      await expect(wallet(page)).toBeFocused();
      await expect(page.getByRole("listbox")).toHaveCount(0);
      const savedFlow = (await (await request.get(`/api/flows/${flowId}`)).json()).data;
      expect(savedFlow.graph.nodes.find((n: { id: string }) => n.id === "p").config.recipient).toBe(
        WALLET,
      );
    });
  }

  test("duplicate names and failed saves stay inline and can be corrected", async ({ page }) => {
    let calls = 0;
    const contacts: Contact[] = [{ label: "Bob", address: OTHER }];
    await page.route("**/api/address-book", async (route) => {
      if (route.request().method() === "POST") {
        calls++;
        if (calls === 1)
          await route.fulfill({
            status: 409,
            json: {
              error: {
                code: "CONFLICT",
                message: "A contact with this name already exists. Choose a different name.",
              },
            },
          });
        else {
          contacts.push({ label: "Diana", address: WALLET });
          await route.fulfill({ json: { data: { label: "Diana", address: WALLET } } });
        }
      } else await route.fulfill({ json: { data: contacts } });
    });
    await open(page);
    await save(page).click();
    await contactName(page).fill("Bob");
    await save(page).click();
    await expect(contactName(page)).toHaveAttribute("aria-invalid", "true");
    expect(calls).toBe(0);
    await contactName(page).fill("Carol");
    await save(page).click();
    await expect(contactName(page)).toHaveAttribute("aria-invalid", "true");
    await expect(contactName(page)).toHaveValue("Carol");
    expect(calls).toBe(1);
    await contactName(page).fill("Diana");
    await save(page).click();
    await expect(
      panel(page).getByRole("status").filter({ hasText: "Saved as Diana" }),
    ).toBeVisible();
    expect(calls).toBe(2);
  });
});
