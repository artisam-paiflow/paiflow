import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import HostedExecutionPanel from "@/components/deploy/hosted-execution-panel";
const toast = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("explicit hosted publishing control", () => {
  it("starts disabled and publishes a link only after the authenticated mutation succeeds", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: { enabled: true } }));
    vi.stubGlobal("fetch", fetcher);
    render(<HostedExecutionPanel deploymentId="deployment" initialEnabled={false} />);
    expect(screen.queryByRole("link", { name: "Open payment form" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Enable payment form" }));
    await screen.findByRole("link", { name: "Open payment form" });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/deployments/deployment/hosted-execution",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ enabled: true }) }),
    );
    expect(toast.success).toHaveBeenCalledWith("Hosted payment form enabled");
  });
  it("keeps previous visibility and exposes an inline error when the server refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { message: "Deployment service is closed" } }, { status: 409 }),
      ),
    );
    render(<HostedExecutionPanel deploymentId="deployment" initialEnabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Enable payment form" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Deployment service is closed"),
    );
    expect(screen.queryByRole("link", { name: "Open payment form" })).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
