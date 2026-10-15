import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NewFlowButton from "@/components/flows/new-flow-button";

const mocks = vi.hoisted(() => ({ push: vi.fn(), fetch: vi.fn(), track: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/analytics/client", () => ({ track: mocks.track }));
vi.mock("@/lib/friendly-toast", () => ({ toastError: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("new-flow control readiness", () => {
  it("renders a native disabled control on the server and becomes interactive only after hydration", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = renderToString(<NewFlowButton>NEW FLOW</NewFlowButton>);
    const serverButton = within(container).getByRole("button", {
      name: "NEW FLOW",
    }) as HTMLButtonElement;
    expect(serverButton.disabled).toBe(true);
    serverButton.click();
    expect(within(container).queryByRole("dialog")).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
    const recoverable = vi.fn();
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, <NewFlowButton>NEW FLOW</NewFlowButton>, {
          onRecoverableError: recoverable,
        });
      });
      const hydratedButton = within(container).getByRole("button", {
        name: "NEW FLOW",
      }) as HTMLButtonElement;
      expect(hydratedButton).toBe(serverButton);
      expect(hydratedButton.disabled).toBe(false);
      expect(recoverable).not.toHaveBeenCalled();
      await act(async () => hydratedButton.click());
      expect(within(container).getByRole("dialog", { name: "Create a new flow" })).toBeDefined();
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(mocks.push).not.toHaveBeenCalled();
      await act(async () => fireEvent.keyDown(window, { key: "Escape" }));
      expect(within(container).queryByRole("dialog")).toBeNull();
      expect(mocks.fetch).not.toHaveBeenCalled();
    } finally {
      if (root) await act(async () => root!.unmount());
      container.remove();
    }
  });
  it("still creates exactly one named draft only after explicit dialog confirmation", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "new-flow-id" } }),
    });
    render(<NewFlowButton ariaLabel="New flow">NEW FLOW</NewFlowButton>);
    const button = screen.getByRole("button", {
      name: "New flow",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: "Create a new flow" });
    expect(mocks.fetch).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Flow name" }), {
      target: { value: "Hydrated draft" },
    });
    await act(async () =>
      fireEvent.click(within(dialog).getByRole("button", { name: /CREATE FLOW/ })),
    );
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith("/api/flows/new", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Hydrated draft" }),
    });
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/flows/new-flow-id");
    expect(mocks.track).toHaveBeenCalledExactlyOnceWith("flow_created", {});
  });
});
