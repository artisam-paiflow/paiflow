import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock env() before importing modules that depend on it so the dev-fallback
// path in lib/mail is exercised.
vi.mock("@/lib/env", () => ({
  env: () => ({
    EMAIL_FROM: "Paiflow <onboarding@resend.dev>",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    // RESEND_API_KEY undefined → triggers dev fallback in lib/mail.
  }),
}));

vi.mock("@/lib/log", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("sendPasswordResetEmail (dev fallback)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns ok with a mock id when RESEND_API_KEY is unset", async () => {
    const { sendPasswordResetEmail } = await import("@/lib/email/password-reset");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await sendPasswordResetEmail({
      to: "user@example.com",
      resetLink: "http://localhost:3000/auth/new-password?token=abc",
      recipientLabel: "alice",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.id).toBe("dev-fallback");
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("escapes HTML metacharacters in the recipient label", async () => {
    const { sendPasswordResetEmail } = await import("@/lib/email/password-reset");
    // Intercept the dev-fallback console.log to inspect the rendered HTML.
    let captured = "";
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((s: unknown) => {
      captured += String(s);
    });
    await sendPasswordResetEmail({
      to: "user@example.com",
      resetLink: "http://localhost:3000/auth/new-password?token=ok",
      recipientLabel: '<script>alert("xss")</script>',
    });
    consoleSpy.mockRestore();

    // Only assert against the HTML body — the plain-text version intentionally
    // doesn't escape (text isn't rendered as HTML).
    const html = sliceHtml(captured);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('<script>alert("xss")</script>');
  });

  it("escapes the reset link before embedding it in the anchor", async () => {
    const { sendPasswordResetEmail } = await import("@/lib/email/password-reset");
    let captured = "";
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((s: unknown) => {
      captured += String(s);
    });
    await sendPasswordResetEmail({
      to: "user@example.com",
      resetLink: 'http://localhost:3000/auth/new-password?token=x"><script>1</script>',
      recipientLabel: "alice",
    });
    consoleSpy.mockRestore();

    const html = sliceHtml(captured);
    expect(html).toContain("&quot;");
    expect(html).not.toContain('"><script>1');
  });
});

/** Pull the HTML body out of the dev-fallback log dump. */
function sliceHtml(captured: string): string {
  const start = captured.indexOf("--- HTML ---");
  const end = captured.indexOf("--- TEXT ---");
  if (start === -1) return captured;
  return end === -1 ? captured.slice(start) : captured.slice(start, end);
}
