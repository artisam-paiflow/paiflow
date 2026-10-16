import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), role: "USER" }));
vi.mock("@/lib/auth", () => ({ requirePageSession: mocks.session }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: mocks.role } } }),
  signOut: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/account/developer",
  notFound: () => {
    throw new Error("not-found");
  },
}));
vi.mock("@/components/developer/token-panel", () => ({
  default: () => <div>Token management panel</div>,
}));
import DeveloperPage from "@/app/account/developer/page";
import Topbar from "@/components/app/topbar";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "USER";
  mocks.session.mockResolvedValue({ id: "owner", username: "Campus", role: "USER" });
});
describe("developer API page and navigation", () => {
  it("requires a live page session before rendering token management", async () => {
    mocks.session.mockRejectedValue(new Error("redirect-to-login"));
    await expect(DeveloperPage()).rejects.toThrow("redirect-to-login");
  });
  it("refuses sandbox identities in the page even without middleware", async () => {
    mocks.session.mockResolvedValue({ id: "sandbox", username: "Visitor", role: "SANDBOX" });
    await expect(DeveloperPage()).rejects.toThrow("not-found");
  });
  it.each(["USER", "ADMIN"])("renders the page and account navigation for %s", async (role) => {
    mocks.role = role;
    mocks.session.mockResolvedValue({ id: "owner", username: "Campus", role });
    const user = userEvent.setup();
    render(await DeveloperPage());
    expect(screen.getByRole("heading", { name: "Developer API" })).toBeTruthy();
    expect(screen.getByText("Token management panel")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Campus" }));
    expect(screen.getByRole("link", { name: "Developer API" }).getAttribute("href")).toBe(
      "/account/developer",
    );
  });
  it("hides developer API navigation from sandbox users", async () => {
    mocks.role = "SANDBOX";
    const user = userEvent.setup();
    render(<Topbar username="Visitor" />);
    await user.click(screen.getByRole("button", { name: "Visitor (SANDBOX)" }));
    expect(screen.queryByRole("link", { name: "Developer API" })).toBeNull();
  });
});
