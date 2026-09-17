/**
 * `/api/cron/*` is public in `middleware.ts` and three of those routes sign
 * with the relayer key, so `requireCronSecret` is the only thing between them
 * and the internet. The guard it replaced was `if (secret && header !== secret)`
 * — a no-op whenever CRON_SECRET was empty. These cases pin the fail-closed
 * behaviour in production and the dev/test convenience that replaced it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv, mockLog } = vi.hoisted(() => ({
  mockEnv: { CRON_SECRET: undefined as string | undefined, NODE_ENV: "test" as string },
  mockLog: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/env", () => ({ env: () => mockEnv }));
vi.mock("@/lib/log", () => ({ log: mockLog }));

import { requireCronSecret } from "@/lib/auth/cron-secret";
import { AppError } from "@/lib/errors";

const VALID = "c".repeat(32);

function makeRequest(secret?: string) {
  return {
    headers: {
      get: (name: string) => (name === "x-cron-secret" ? (secret ?? null) : null),
    },
  } as unknown as import("next/server").NextRequest;
}

function expectForbidden(secret?: string) {
  try {
    requireCronSecret(makeRequest(secret));
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("FORBIDDEN");
    return;
  }
  throw new Error("expected requireCronSecret to throw FORBIDDEN");
}

describe("requireCronSecret", () => {
  beforeEach(() => {
    mockEnv.CRON_SECRET = VALID;
    mockEnv.NODE_ENV = "test";
    mockLog.error.mockClear();
  });

  it("accepts the matching secret", () => {
    expect(() => requireCronSecret(makeRequest(VALID))).not.toThrow();
  });

  it("rejects a wrong secret of the same length", () => {
    expect(VALID.length).toBe(32);
    expectForbidden("d".repeat(32));
  });

  it("rejects a missing header", () => {
    expectForbidden(undefined);
  });

  it("rejects a prefix of the secret", () => {
    expectForbidden(VALID.slice(0, 31));
  });

  describe("in production", () => {
    beforeEach(() => {
      mockEnv.NODE_ENV = "production";
    });

    it("refuses when CRON_SECRET is unset, whatever the caller presents", () => {
      mockEnv.CRON_SECRET = undefined;
      expectForbidden(undefined);
      expectForbidden("anything");
    });

    it("refuses a 31-char secret even when the caller presents it", () => {
      const short = "e".repeat(31);
      mockEnv.CRON_SECRET = short;
      expectForbidden(short);
    });

    it("accepts a 32-char secret", () => {
      expect(() => requireCronSecret(makeRequest(VALID))).not.toThrow();
    });

    // A fresh module instance, because the flag that makes this once-per-process
    // has already been tripped by the cases above.
    it("logs the misconfiguration once per process, without the value", async () => {
      vi.resetModules();
      const fresh = await import("@/lib/auth/cron-secret");
      mockEnv.CRON_SECRET = undefined;
      mockLog.error.mockClear();

      for (let i = 0; i < 3; i++) {
        expect(() => fresh.requireCronSecret(makeRequest("anything"))).toThrow();
      }

      expect(mockLog.error).toHaveBeenCalledTimes(1);
      const [ctx, msg] = mockLog.error.mock.calls[0] as [Record<string, unknown>, string];
      expect(ctx).toEqual({ present: false });
      expect(msg).toMatch(/CRON_SECRET/);
    });

    it("does not log the secret when it is merely too short", async () => {
      vi.resetModules();
      const fresh = await import("@/lib/auth/cron-secret");
      const short = "f".repeat(31);
      mockEnv.CRON_SECRET = short;
      mockLog.error.mockClear();

      expect(() => fresh.requireCronSecret(makeRequest(short))).toThrow();

      expect(mockLog.error).toHaveBeenCalledTimes(1);
      const [ctx] = mockLog.error.mock.calls[0] as [Record<string, unknown>, string];
      // Present but unusable, and neither the value nor its length is logged.
      expect(ctx).toEqual({ present: true });
      expect(JSON.stringify(ctx)).not.toContain(short);
    });
  });

  describe("outside production", () => {
    it("allows an unheadered call when CRON_SECRET is unset", () => {
      mockEnv.CRON_SECRET = undefined;
      mockEnv.NODE_ENV = "development";
      expect(() => requireCronSecret(makeRequest())).not.toThrow();
      mockEnv.NODE_ENV = "test";
      expect(() => requireCronSecret(makeRequest())).not.toThrow();
    });

    it("still enforces a secret that is set", () => {
      mockEnv.NODE_ENV = "development";
      expectForbidden("wrong");
    });
  });
});
