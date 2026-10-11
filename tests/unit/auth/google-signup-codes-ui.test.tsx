import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import GoogleSignupCodes from "@/components/admin/google-signup-codes";

const codes = Array.from({ length: 102 }, (_, index) => ({
  id: `code-${index}`,
  label: index === 101 ? "Older active code" : `Newer code ${index}`,
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
  disabledAt: null as string | null,
}));
const response = (data: unknown, ok = true) => Promise.resolve({ ok, json: async () => data });
afterEach(() => vi.unstubAllGlobals());

describe("admin signup code pagination", () => {
  it("navigates past 100 newer codes, disables an older active code, and returns to page 1", async () => {
    const user = userEvent.setup();
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => response({ data: codes.slice(100), nextCursor: null }))
      .mockImplementationOnce(() =>
        response({ data: { ...codes[101], disabledAt: "2026-01-02T00:00:00.000Z" } }),
      )
      .mockImplementationOnce(() =>
        response({ data: codes.slice(0, 100), nextCursor: codes[99]!.id }),
      );
    vi.stubGlobal("fetch", fetcher);
    render(<GoogleSignupCodes initial={codes.slice(0, 100)} initialNextCursor={codes[99]!.id} />);
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Older active code · Active")).toBeTruthy();
    expect(screen.getByText("Page 2")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getAllByRole("button", { name: "Disable" })[1]!);
    expect(await screen.findByText("Older active code · Disabled")).toBeTruthy();
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/admin/google-signup-codes/code-101",
      expect.objectContaining({ method: "PATCH" }),
    );
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByText("Newer code 0 · Active")).toBeTruthy();
    expect(screen.getByText("Page 1")).toBeTruthy();
    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/admin/google-signup-codes?cursor=code-99", {
      cache: "no-store",
    });
  });

  it("keeps current rows and pagination available when navigation fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response({ error: { message: "Could not load codes." } }, false)),
    );
    render(<GoogleSignupCodes initial={codes.slice(0, 100)} initialNextCursor={codes[99]!.id} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Could not load codes.");
    expect(screen.getByText("Newer code 0 · Active")).toBeTruthy();
    expect(screen.getByText("Page 1")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it.each([false, true])(
    "preserves an issued code after creation on a later page (reload fails: %s)",
    async (failReload) => {
      const user = userEvent.setup();
      const fetcher = vi
        .fn()
        .mockImplementationOnce(() => response({ data: codes.slice(100), nextCursor: null }))
        .mockImplementationOnce(() => response({ data: { code: "once-only-secret" } }))
        .mockImplementationOnce(() =>
          failReload
            ? response({ error: { message: "Reload failed" } }, false)
            : response({
                data: [{ ...codes[0], label: "Brand new code" }],
                nextCursor: codes[99]!.id,
              }),
        );
      vi.stubGlobal("fetch", fetcher);
      render(<GoogleSignupCodes initial={codes.slice(0, 100)} initialNextCursor={codes[99]!.id} />);
      await user.click(screen.getByRole("button", { name: "Next" }));
      await screen.findByText("Page 2");
      await user.type(screen.getByRole("textbox"), "New event");
      await user.click(screen.getByRole("button", { name: "Create code" }));
      expect(await screen.findByText("once-only-secret")).toBeTruthy();
      if (failReload) {
        expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Reload failed");
        expect(screen.getByText("Older active code · Active")).toBeTruthy();
        expect(screen.getByText("Page 2")).toBeTruthy();
      } else {
        await waitFor(() => expect(screen.getByText("Page 1")).toBeTruthy());
        expect(screen.getByText("Brand new code · Active")).toBeTruthy();
      }
    },
  );
});
