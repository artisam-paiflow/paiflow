import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), flows: vi.fn(), deployments: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePageSession: mocks.session }));
vi.mock("@/lib/db", () => ({ db: { deployment: { findMany: mocks.deployments } } }));
vi.mock("@/lib/dashboard/flows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dashboard/flows")>()),
  dashboardFlows: mocks.flows,
}));
vi.mock("@/components/app/topbar", () => ({ default: () => null }));
vi.mock("@/components/flows/delete-flow-button", () => ({
  default: ({ hasDeployments }: { hasDeployments: boolean }) => (
    <button disabled={hasDeployments}>Delete flow</button>
  ),
}));
vi.mock("@/components/flows/new-flow-button", () => ({
  default: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));
vi.mock("@/components/deploy/retirement-panel", () => ({ default: () => null }));

import Dashboard from "@/app/dashboard/page";

const flowId = "11111111-1111-4111-8111-111111111111";
const cursor = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ id: "owner", username: "Campus" });
  mocks.flows.mockResolvedValue({ items: [], nextCursor: null });
  mocks.deployments.mockResolvedValue([]);
});

describe("dashboard flow views", () => {
  it("requires a session before reading definitions", async () => {
    mocks.session.mockRejectedValue(new Error("redirect-to-login"));
    await expect(Dashboard({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "redirect-to-login",
    );
    expect(mocks.flows).not.toHaveBeenCalled();
    expect(mocks.deployments).not.toHaveBeenCalled();
  });

  it("defaults to current flows and explains how to find retained definitions", async () => {
    render(await Dashboard({ searchParams: Promise.resolve({}) }));
    expect(mocks.flows).toHaveBeenCalledWith("owner", { view: "current" });
    expect(screen.getByRole("link", { name: "Current flows" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "Retired flows" }).getAttribute("href")).toBe(
      "/dashboard?view=retired",
    );
    expect(
      screen.getByText("No current flows. Create a flow or view your retired flows."),
    ).toBeTruthy();
    expect(screen.getByText("CURRENT FLOWS SHOWN")).toBeTruthy();
    expect(screen.getByText("NO ACTIVE OR RETIRING DEPLOYMENTS.")).toBeTruthy();
  });

  it("links to retained definitions and keeps pagination in the retired view", async () => {
    mocks.flows.mockResolvedValue({
      items: [
        {
          id: flowId,
          name: "Old automation",
          templateKind: "SPLITTER",
          updatedAt: new Date(),
          _count: { deployments: 2 },
        },
      ],
      nextCursor: cursor,
    });
    render(await Dashboard({ searchParams: Promise.resolve({ view: "retired", cursor: flowId }) }));
    expect(mocks.flows).toHaveBeenCalledWith("owner", { view: "retired", cursor: flowId });
    expect(screen.getByRole("link", { name: /Old automation/ }).getAttribute("href")).toBe(
      `/flows/${flowId}`,
    );
    expect(screen.getByRole("button", { name: "Delete flow" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("link", { name: "Older flows" }).getAttribute("href")).toBe(
      `/dashboard?view=retired&cursor=${cursor}`,
    );
    expect(screen.getByRole("link", { name: "Newest flows" }).getAttribute("href")).toBe(
      "/dashboard?view=retired",
    );
    expect(screen.getByText(/Retired deployments remain inaccessible/)).toBeTruthy();
    expect(mocks.deployments).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: "owner", serviceState: { not: "RETIRED" } } }),
    );
  });

  it("shows the retired empty state without claiming there are no flows", async () => {
    render(await Dashboard({ searchParams: Promise.resolve({ view: "retired" }) }));
    expect(screen.getByText("No fully retired flows.")).toBeTruthy();
    expect(screen.getByText("RETIRED FLOWS SHOWN")).toBeTruthy();
  });

  it("offers recovery when a cursor no longer belongs to the selected view", async () => {
    render(await Dashboard({ searchParams: Promise.resolve({ cursor }) }));
    expect(screen.getByText("No flows on this page. Return to the newest flows.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Newest flows" }).getAttribute("href")).toBe(
      "/dashboard",
    );
  });

  it("counts active deployments within the displayed rows without counting retiring ones", async () => {
    mocks.deployments.mockResolvedValue(
      (["ACTIVE", "RETIRING"] as const).map((serviceState, i) => ({
        id: `deployment-${i}`,
        serviceState,
        status: "CONFIRMED",
        network: "testnet",
        contractAddress: null,
        createdAt: new Date(),
        flow: { name: `Flow ${i}` },
      })),
    );
    render(await Dashboard({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("1 ACTIVE OF 2 SHOWN")).toBeTruthy();
    expect(screen.getByText("RETIRING")).toBeTruthy();
  });
});
