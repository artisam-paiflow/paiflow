import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GoogleButton from "@/components/auth/google-button";
import LoginForm from "@/components/auth/login-form";
import { googleErrorMessage } from "@/lib/auth/google-messages";
const signIn = vi.hoisted(() => vi.fn());
vi.mock("next-auth/react", () => ({ signIn }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.clearAllMocks();
});
describe("Google sign-in UI", () => {
  it("offers Google beside password sign-in and does not require password fields for Google", async () => {
    render(<LoginForm googleEnabled from="/flows" />);
    const password = screen.getByRole("button", { name: "SIGN IN" });
    const google = screen.getByRole("button", { name: "Continue with Google" });
    expect(google.parentElement?.parentElement).toBe(password.parentElement);
    expect(google.getAttribute("type")).toBe("button");
    expect(google.querySelector("img")?.getAttribute("src")).toBe("/google-g.png");
    await userEvent.click(google);
    expect(signIn).toHaveBeenCalledWith("google", { redirectTo: "/flows" });
  });
  it("starts Google sign-in with safe same-origin return navigation", async () => {
    render(<GoogleButton from="https://attacker.example/" />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(signIn).toHaveBeenCalledWith("google", { redirectTo: "/dashboard" });
  });
  it("requires explicit successful link consent before OAuth navigation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: { message: "Sign out and sign in again, then link Google within five minutes." },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GoogleButton link />);
    await userEvent.click(screen.getByRole("button", { name: "Link Google" }));
    expect(screen.getByRole("alert").textContent).toContain("Sign out and sign in again");
    expect(signIn).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/google/link",
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
  });
  it("shows an inline error if Google initialization fails", async () => {
    signIn.mockRejectedValueOnce(new Error("private-provider-details"));
    render(<GoogleButton />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(screen.getByRole("alert").textContent).toBe(
      "Could not start Google sign-in. Please try again.",
    );
  });
  it("displays fixed copy for cancellation and collisions, never reflected provider text", () => {
    expect(googleErrorMessage("OAuthCallbackError")).toContain("cancelled");
    expect(googleErrorMessage("<script>private code</script>")).not.toContain("script");
    expect(googleErrorMessage("email-conflict")).toContain("link Google from Account settings");
  });
});

describe("Google code modal", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  });
  it("shows the code field immediately on the signup screen and continues after validation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: { ok: true } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<GoogleButton signup codeScreen from="/flows/new" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(signIn).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Access code"), "organizer-code");
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/google/signup",
      expect.objectContaining({ body: JSON.stringify({ code: "organizer-code" }) }),
    );
    expect(signIn).toHaveBeenCalledWith("google", { redirectTo: "/flows/new" });
  });
  it("opens the code modal before OAuth and automatically continues after server validation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: { ok: true } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<GoogleButton signup />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(signIn).not.toHaveBeenCalled();
    const input = screen.getByLabelText("Access code");
    await userEvent.type(input, "hackathon-code");
    await userEvent.click(screen.getAllByRole("button", { name: "Continue with Google" })[1]!);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/google/signup",
      expect.objectContaining({ body: JSON.stringify({ code: "hackathon-code" }) }),
    );
    expect(signIn).toHaveBeenCalledWith("google", { redirectTo: "/dashboard" });
  });
  it("keeps expired/disabled code feedback in the modal and does not start OAuth", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { message: "This code is disabled. Ask your organizer for a new code." },
        }),
      }),
    );
    render(<GoogleButton signup />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await userEvent.type(screen.getByLabelText("Access code"), "disabled-code");
    await userEvent.click(screen.getAllByRole("button", { name: "Continue with Google" })[1]!);
    expect(screen.getByRole("alert").textContent).toContain("disabled");
    expect(signIn).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
