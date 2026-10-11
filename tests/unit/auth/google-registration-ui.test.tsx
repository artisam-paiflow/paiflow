import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const flags = vi.hoisted(() => ({
  AUTH_URL: "http://localhost:3000",
  ALLOW_PUBLIC_REGISTRATION: false,
  GOOGLE_AUTH_ENABLED: false,
  ALLOW_GOOGLE_REGISTRATION: false,
}));
vi.mock("@/lib/env", () => ({ env: () => flags }));
vi.mock("@/components/auth/register-form", () => ({
  default: () => <div>Password registration form</div>,
}));
vi.mock("@/components/app/logo", () => ({ default: () => <span>Paiflow</span> }));
import RegisterPage from "@/app/register/page";
import GoogleSignupPage from "@/app/auth/signup/page";
afterEach(() => cleanup());
describe("independent registration UI gates", () => {
  it("shows the signup code field immediately for a new Google user", async () => {
    Object.assign(flags, { GOOGLE_AUTH_ENABLED: true, ALLOW_GOOGLE_REGISTRATION: true });
    render(await GoogleSignupPage({ searchParams: Promise.resolve({ from: "/flows" }) }));
    expect(screen.getByRole("heading", { name: "Complete your signup." })).toBeTruthy();
    expect(screen.getByLabelText("Access code")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("does not offer code entry when Google registration closes", async () => {
    Object.assign(flags, { GOOGLE_AUTH_ENABLED: true, ALLOW_GOOGLE_REGISTRATION: false });
    render(await GoogleSignupPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByLabelText("Access code")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("registrations are currently closed");
  });
  it("offers Google registration without opening password registration", () => {
    Object.assign(flags, {
      ALLOW_PUBLIC_REGISTRATION: false,
      GOOGLE_AUTH_ENABLED: true,
      ALLOW_GOOGLE_REGISTRATION: true,
    });
    render(<RegisterPage />);
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
    expect(screen.queryByText("Password registration form")).toBeNull();
  });
  it("shows disabled registration when Google creation is closed", () => {
    Object.assign(flags, {
      ALLOW_PUBLIC_REGISTRATION: false,
      GOOGLE_AUTH_ENABLED: true,
      ALLOW_GOOGLE_REGISTRATION: false,
    });
    render(<RegisterPage />);
    expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();
    expect(screen.getByText("REGISTRATION DISABLED")).toBeTruthy();
  });
  it("preserves independent password registration", () => {
    Object.assign(flags, {
      ALLOW_PUBLIC_REGISTRATION: true,
      GOOGLE_AUTH_ENABLED: false,
      ALLOW_GOOGLE_REGISTRATION: false,
    });
    render(<RegisterPage />);
    expect(screen.getByText("Password registration form")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();
  });
});
