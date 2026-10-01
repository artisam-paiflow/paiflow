import { beforeEach, describe, expect, it, vi } from "vitest";
const config = vi.hoisted(() => ({ NODE_ENV: "test" }));
vi.mock("@/lib/env", () => ({
  env: () => ({ ...config, EMAIL_FROM: "Paiflow <noreply@example.com>" }),
}));
vi.mock("@/lib/log", () => ({ log: { info: vi.fn(), error: vi.fn() } }));
import { sendEmail } from "@/lib/mail";
import { log } from "@/lib/log";

describe("mail privacy", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["test", "production"])("does not print email content in %s", async (nodeEnv) => {
    config.NODE_ENV = nodeEnv;
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

  it("prints the body in development for local password resets", async () => {
    config.NODE_ENV = "development";
    await sendEmail({
      to: "local@example.com",
      subject: "Reset password",
      html: "<a href='http://localhost/reset'>Reset</a>",
      text: "http://localhost/reset",
    });
    expect(log.info).toHaveBeenCalledWith(
      {
        html: "<a href='http://localhost/reset'>Reset</a>",
        text: "http://localhost/reset",
      },
      "[mail:dev-fallback] email body",
    );
  });
});
