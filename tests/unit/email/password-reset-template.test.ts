import { beforeEach, describe, expect, it, vi } from "vitest";
const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mail", () => ({ sendEmail: send }));
import { sendPasswordResetEmail } from "@/lib/email/password-reset";

beforeEach(() => {
  send.mockReset().mockResolvedValue({ ok: true, id: "mail-id" });
});
describe("sendPasswordResetEmail template", () => {
  it("passes the rendered email to the transport and returns its result", async () => {
    expect(
      await sendPasswordResetEmail({
        to: "user@example.com",
        resetLink: "https://example.com/reset?token=abc",
        recipientLabel: "alice",
      }),
    ).toEqual({ ok: true, id: "mail-id" });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        text: expect.stringContaining("token=abc"),
      }),
    );
  });
  it("escapes HTML metacharacters in the recipient label", async () => {
    await sendPasswordResetEmail({
      to: "user@example.com",
      resetLink: "https://example.com/reset",
      recipientLabel: '<script>alert("xss")</script>',
    });
    const html = send.mock.calls[0]![0].html;
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('<script>alert("xss")</script>');
  });
  it("escapes the reset link before embedding it in an anchor", async () => {
    await sendPasswordResetEmail({
      to: "user@example.com",
      resetLink: 'https://example.com/reset?token=x"><script>1</script>',
      recipientLabel: "alice",
    });
    const html = send.mock.calls[0]![0].html;
    expect(html).toContain("&quot;");
    expect(html).not.toContain('\"><script>1');
  });
});
