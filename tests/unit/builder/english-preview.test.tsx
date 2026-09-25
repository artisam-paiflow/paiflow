import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import EnglishPreview from "@/components/builder/english-preview";

const SENTENCE = "When this contract receives USDC, split USDC — 60% to Alice, 40% to Bob.";

function renderPreview(overrides: Partial<React.ComponentProps<typeof EnglishPreview>> = {}) {
  const props = {
    english: SENTENCE,
    showValidBadge: true,
    hasFiatPayout: false,
    hasSenderKyc: false,
    devMode: false,
    errorCount: 0,
    onOpenKyc: vi.fn(),
    onOpenErrors: vi.fn(),
    ...overrides,
  };
  render(<EnglishPreview {...props} />);
  return props;
}

describe("EnglishPreview", () => {
  it("starts collapsed on phones and toggles the sentence", async () => {
    renderPreview();
    const toggle = screen.getByRole("button", { name: "Show English preview" });
    const text = screen.getByTestId("english-preview-text");

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe(text.id);
    expect(text.className).toContain("max-md:hidden");
    expect(text.textContent).toBe(SENTENCE);

    await userEvent.click(toggle);

    const hide = screen.getByRole("button", { name: "Hide English preview" });
    expect(hide.getAttribute("aria-expanded")).toBe("true");
    expect(text.className).not.toContain("max-md:hidden");
    expect(text.className).toContain("max-md:line-clamp-none");
  });

  it("keeps the error count reachable while collapsed", async () => {
    const props = renderPreview({ showValidBadge: false, errorCount: 2 });
    const errors = screen.getByRole("button", { name: "View all 2 validation issues" });
    expect(screen.getByRole("alert").contains(errors)).toBe(true);

    expect(screen.getByTestId("english-preview-text").className).toContain("max-md:hidden");
    await userEvent.click(errors);
    expect(props.onOpenErrors).toHaveBeenCalledOnce();
  });

  it("shows the Sender KYC button for fiat payouts", async () => {
    const props = renderPreview({ hasFiatPayout: true });
    await userEvent.click(screen.getByRole("button", { name: /Sender KYC/ }));
    expect(props.onOpenKyc).toHaveBeenCalledOnce();
  });

  it("has no axe violations", async () => {
    renderPreview({ hasFiatPayout: true, errorCount: 1, showValidBadge: false });
    const results = await axe.run(document.body, { rules: { region: { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
