/**
 * Active browser coverage stops at the deployment review, before wallet access.
 * Wallet signing/submission and funded event acceptance remain tracked in #1003;
 * the explicitly skipped test below must not be counted as passing that coverage.
 */
import { test, expect } from "@playwright/test";

test("builder → deployment review (before wallet signing)", async ({ page }) => {
  // Login uses the normal local E2E setup. This test creates only a draft flow.
  await page.goto("/dashboard");
  // Dashboard can show a header action, an empty-state action and a mobile FAB.
  const newFlow = page
    .getByRole("button", { name: /new flow/i })
    .filter({ visible: true })
    .first();
  await newFlow.click();
  const createDialog = page.getByRole("dialog", { name: "Create a new flow", exact: true });
  await expect(createDialog).toBeVisible();
  await createDialog
    .getByRole("textbox", { name: "Flow name", exact: true })
    .fill("E2E builder review");
  await Promise.all([
    page.waitForURL(/\/flows\/[0-9a-f-]+$/, { timeout: 15_000 }),
    createDialog.getByRole("button", { name: /CREATE FLOW/ }).click(),
  ]);
  const flowId = page.url().match(/\/flows\/([0-9a-f-]+)/)![1];

  await page.goto(`/flows/${flowId}/deploy`);
  await expect(page.getByText("ENGLISH PREVIEW", { exact: true })).toBeVisible();
  await expect(page.getByText(/When this contract receives/)).toBeVisible();
  // The server pins the network; review must display it before any wallet action.
  await expect(page.getByTestId("network-chip")).toBeVisible();
  const deployButton = page.getByRole("button", { name: /DEPLOY TO (TESTNET|MAINNET)/ });
  await expect(deployButton).toBeVisible({ timeout: 20_000 });
  await expect(deployButton).toBeEnabled();
});

test.skip(
  "wallet deployment → confirmed contract → funded events (acceptance pending #1003)",
  {
    annotation: [
      { type: "issue", description: "https://github.com/webnxt-2030/pinkraft/issues/1003" },
      {
        type: "skip",
        description:
          "No working browser wallet harness. This skipped test is not automatic wallet/deployment acceptance.",
      },
    ],
  },
  async () => {
    // A missing wallet must never become a successful timeout/early return.
    // Replace this guard with the complete acceptance flow before unskipping.
    throw new Error("Implement the tracked browser wallet acceptance flow before enabling it.");
  },
);
