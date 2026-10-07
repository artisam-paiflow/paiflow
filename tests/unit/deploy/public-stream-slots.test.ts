import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  client: null as null | { eval: ReturnType<typeof vi.fn>; zrem: ReturnType<typeof vi.fn> },
}));
vi.mock("@/lib/redis", () => ({ redis: () => mocks.client }));
import {
  acquirePublicStreamSlot,
  PUBLIC_STREAM_LEASE_MS,
  PUBLIC_STREAM_LIFETIME_MS,
} from "@/lib/deployments/public-stream-slots";
beforeEach(() => {
  mocks.client = { eval: vi.fn().mockResolvedValue(1), zrem: vi.fn().mockResolvedValue(1) };
});
describe("shared public stream admission", () => {
  it("fails closed when Redis is unavailable or fails", async () => {
    mocks.client!.eval.mockRejectedValue(new Error("Redis unavailable"));
    expect(await acquirePublicStreamSlot("ip", "deployment")).toBeNull();
    mocks.client = null;
    expect(await acquirePublicStreamSlot("ip", "deployment")).toBeNull();
  });
  it("returns a retryable rate limit when a shared cap is exhausted", async () => {
    mocks.client!.eval.mockResolvedValue(0);
    await expect(acquirePublicStreamSlot("ip", "deployment")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryAfterSeconds: 15,
    });
  });
  it("releases all held limits exactly once, including when one release fails", async () => {
    const slot = await acquirePublicStreamSlot("ip", "deployment");
    mocks.client!.zrem.mockRejectedValueOnce(new Error("redis lost"));
    await slot!.release();
    await slot!.release();
    expect(mocks.client!.zrem).toHaveBeenCalledTimes(3);
    expect(mocks.client!.zrem.mock.calls.map((args) => args[0])).toEqual([
      "public-embed:streams:total",
      "public-embed:streams:ip:ip",
      "public-embed:streams:deployment:deployment",
    ]);
    expect(PUBLIC_STREAM_LIFETIME_MS).toBeLessThan(PUBLIC_STREAM_LEASE_MS);
  });
});
