import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GoogleButton from "@/components/auth/google-button";
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
