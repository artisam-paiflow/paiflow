import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePageSession: mocks.session }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
}));
vi.mock("@/components/app/topbar", () => ({ default: () => <div>Navigation</div> }));
vi.mock("@/components/flow-templates/template-manager", () => ({
  default: ({ ownerId, seedFlowId }: { ownerId: string; seedFlowId?: string }) => (
    <div>
      Private owner {ownerId} · seed {seedFlowId}
    </div>
  ),
}));
import Page from "@/app/flow-templates/page";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ id: "owner", role: "USER", username: "Developer" });
});
describe("private template page guards", () => {
  it("requires a live authenticated page session", async () => {
    mocks.session.mockRejectedValue(new Error("redirect"));
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect");
  });
  it("refuses sandbox without relying on middleware", async () => {
    mocks.session.mockResolvedValue({ id: "sandbox", role: "SANDBOX" });
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("not-found");
  });
  it("passes authenticated owner identity and accepts only UUID seed references", async () => {
    render(await Page({ searchParams: Promise.resolve({ flowId: "https://attacker.invalid" }) }));
    expect(screen.getByRole("heading", { name: "Private templates" })).toBeTruthy();
    expect(screen.getByText(/Private owner owner/).textContent).not.toContain("attacker");
  });
});
