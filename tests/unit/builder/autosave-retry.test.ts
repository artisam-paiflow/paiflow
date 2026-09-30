import { describe, expect, it, vi } from "vitest";
import {
  MAX_RATE_LIMIT_RETRIES,
  RETRY_FALLBACK_MS,
  RETRY_MAX_WAIT_MS,
  retryAfterMs,
  sendWithRateLimitRetry,
} from "@/components/builder/autosave-retry.utils";
import { AppError, errorResponse } from "@/lib/errors";

const res = (status: number, retryAfter?: string) =>
  new Response(null, { status, headers: retryAfter ? { "Retry-After": retryAfter } : {} });

describe("retryAfterMs", () => {
  it("converts seconds, bounded", () => {
    expect(retryAfterMs("5")).toBe(5000);
    expect(retryAfterMs("0")).toBe(250);
    expect(retryAfterMs("9999")).toBe(RETRY_MAX_WAIT_MS);
  });
  it("falls back on a missing or junk header", () => {
    expect(retryAfterMs(null)).toBe(RETRY_FALLBACK_MS);
    expect(retryAfterMs("soon")).toBe(RETRY_FALLBACK_MS);
    expect(retryAfterMs("-3")).toBe(RETRY_FALLBACK_MS);
  });
});

describe("sendWithRateLimitRetry", () => {
  it("returns a success without sleeping", async () => {
    const sleep = vi.fn(async () => {});
    const send = vi.fn(async () => res(200));
    expect((await sendWithRateLimitRetry(send, sleep)).status).toBe(200);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("waits Retry-After on 429, then succeeds, calling send afresh", async () => {
    const sleep = vi.fn(async () => {});
    const send = vi.fn().mockResolvedValueOnce(res(429, "2")).mockResolvedValueOnce(res(200));
    expect((await sendWithRateLimitRetry(send, sleep)).status).toBe(200);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("gives up after the bounded attempts and returns the 429", async () => {
    const sleep = vi.fn(async () => {});
    const send = vi.fn(async () => res(429, "1"));
    expect((await sendWithRateLimitRetry(send, sleep)).status).toBe(429);
    expect(send).toHaveBeenCalledTimes(MAX_RATE_LIMIT_RETRIES + 1);
  });

  it.each([400, 401, 409, 422, 500])("does not retry %i", async (status) => {
    const sleep = vi.fn(async () => {});
    const send = vi.fn(async () => res(status));
    expect((await sendWithRateLimitRetry(send, sleep)).status).toBe(status);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("Retry-After on RATE_LIMITED", () => {
  it("is sent when the error carries it", () => {
    const r = errorResponse(new AppError("RATE_LIMITED", "slow", undefined, undefined, 7));
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("7");
  });
  it("is absent otherwise", () => {
    expect(
      errorResponse(new AppError("RATE_LIMITED", "slow")).headers.get("retry-after"),
    ).toBeNull();
  });
});
