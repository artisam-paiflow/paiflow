import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/redis", () => ({ redis: () => null }));

import { enforceWriteRateLimit, WRITE_RATE_LIMITS } from "@/lib/api/write-rate-limit";
import { AppError } from "@/lib/errors";

describe("enforceWriteRateLimit", () => {
  it("allows up to the limit, then throws RATE_LIMITED", async () => {
    const subject = `u-${Math.random()}`;
    const { limit } = WRITE_RATE_LIMITS.revokeAllSessions;
    for (let i = 0; i < limit; i++) await enforceWriteRateLimit("revokeAllSessions", subject);
    const err = await enforceWriteRateLimit("revokeAllSessions", subject).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("RATE_LIMITED");
  });

  it("keeps subjects and names apart", async () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    const { limit } = WRITE_RATE_LIMITS.revokeAllSessions;
    for (let i = 0; i < limit; i++) await enforceWriteRateLimit("revokeAllSessions", a);
    await expect(enforceWriteRateLimit("revokeAllSessions", b)).resolves.toBeUndefined();
    await expect(enforceWriteRateLimit("passkeyManage", a)).resolves.toBeUndefined();
  });

  it("sizes the status poll for a 2s poll on a few tabs", () => {
    expect(WRITE_RATE_LIMITS.deploymentStatus.limit).toBeGreaterThanOrEqual(30 * 3);
  });
});
