import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import AuditLog from "@/components/admin/audit-log";
import type { AuditLogPage } from "@/lib/admin/audit-log/page";

function page(action = "USER_LOGIN", nextCursor: string | null = "cursor-20"): AuditLogPage {
  return {
    items: [
      {
        id: action,
        action,
        userId: null,
        ip: null,
        userAgent: null,
        metadata: null,
        user: null,
        createdAt: "2026-10-25T00:00:00.000Z",
      },
    ],
    nextCursor,
  };
}
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("admin audit log UI", () => {
  it("browses older and newer pages and disables boundary controls", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ data: page("USER_LOGOUT", null) }))
      .mockResolvedValueOnce(response({ data: page() }));
    vi.stubGlobal("fetch", fetcher);
    render(<AuditLog initial={page()} />);
    expect((screen.getByRole("button", { name: "Newer" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Older" }));
    expect(await screen.findByText("USER_LOGOUT")).toBeTruthy();
    expect(screen.getByText("Page 2")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Older" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/admin/audit-log?limit=20&cursor=cursor-20",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Newer" }));
    expect(await screen.findByText("USER_LOGIN")).toBeTruthy();
    expect(screen.getByText("Page 1")).toBeTruthy();
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/admin/audit-log?limit=20", expect.any(Object));
  });

  it("announces loading and keeps the current page when a request fails, allowing retry", async () => {
    let finish!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        )
        .mockResolvedValueOnce(response({ data: page("USER_LOGOUT", null) })),
    );
    render(<AuditLog initial={page()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Older" }));
    expect(screen.getByRole("status").textContent).toBe("Loading audit events…");
    expect((screen.getByRole("button", { name: "Older" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await act(async () =>
      finish(response({ error: { message: "Could not load audit events." } }, false)),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Could not load audit events.",
    );
    expect(screen.getByText("USER_LOGIN")).toBeTruthy();
    expect(screen.getByText("Page 1")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Older" }));
    expect(await screen.findByText("USER_LOGOUT")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the empty state without enabling navigation", () => {
    render(<AuditLog initial={{ items: [], nextCursor: null }} />);
    expect(screen.getByText("NO EVENTS YET.")).toBeTruthy();
    for (const button of screen.getAllByRole("button"))
      expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it.each(["Asia/Manila", "America/New_York"])(
    "hydrates cleanly and renders the browser timezone %s",
    async (timeZone) => {
      const OriginalDateTimeFormat = Intl.DateTimeFormat;
      vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (_locales, options) {
        return new OriginalDateTimeFormat("en-US", { ...options, timeZone });
      });
      const initial = page();
      const html = renderToString(<AuditLog initial={initial} />);
      expect(html).toContain("UTC");
      expect(html).toContain(initial.items[0]!.createdAt);
      const container = document.createElement("div");
      document.body.append(container);
      container.innerHTML = html;
      const onRecoverableError = vi.fn();
      let root!: ReturnType<typeof hydrateRoot>;
      try {
        await act(async () => {
          root = hydrateRoot(container, <AuditLog initial={initial} />, { onRecoverableError });
        });
        await waitFor(() => expect(container.textContent).toContain(timeZone));
        const timestamp = container.querySelector("time")!;
        expect(timestamp.textContent).toBe(
          new OriginalDateTimeFormat("en-US", {
            dateStyle: "medium",
            timeStyle: "medium",
            timeZone,
          }).format(new Date(initial.items[0]!.createdAt)),
        );
        expect(timestamp.dateTime).toBe(initial.items[0]!.createdAt);
        expect(timestamp.title).toBe(`${initial.items[0]!.createdAt} (UTC)`);
        expect(onRecoverableError).not.toHaveBeenCalled();
      } finally {
        await act(async () => root?.unmount());
        container.remove();
      }
    },
  );
});
