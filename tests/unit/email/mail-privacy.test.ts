import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/log", () => ({ log: { info: vi.fn(), error: vi.fn() } }));
import { sendEmail } from "@/lib/mail";
import { log } from "@/lib/log";

describe("mail privacy", () => {
  it("does not print addresses, subject or content in the dev fallback", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await sendEmail({
      to: "private@example.com",
      subject: "Private payment",
      text: "Private body",
      html: "Private body",
    });
    expect(result).toEqual({ ok: true, id: "dev-fallback" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(JSON.stringify(vi.mocked(log.info).mock.calls)).not.toMatch(/private@example|Private/);
  });
});
