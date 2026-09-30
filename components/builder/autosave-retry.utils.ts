/** Attempts after the first one; a 429 that outlasts them is reported like any failed save. */
export const MAX_RATE_LIMIT_RETRIES = 3;
export const RETRY_FALLBACK_MS = 3_000;
export const RETRY_MAX_WAIT_MS = 30_000;

/** `Retry-After` in seconds (the only form the API sends) as a bounded delay in ms. */
export function retryAfterMs(header: string | null): number {
  const seconds = header === null ? NaN : Number(header.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return RETRY_FALLBACK_MS;
  return Math.min(Math.max(seconds * 1000, 250), RETRY_MAX_WAIT_MS);
}

/**
 * Run `send`; on HTTP 429 wait out `Retry-After` and run it again, up to MAX_RATE_LIMIT_RETRIES
 * times. Any other status (4xx included) is returned at once. `send` is called afresh each time so
 * it can read the newest state instead of resending a stale body.
 */
export async function sendWithRateLimitRetry(
  send: () => Promise<Response>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<Response> {
  let res = await send();
  for (let i = 0; i < MAX_RATE_LIMIT_RETRIES && res.status === 429; i++) {
    await sleep(retryAfterMs(res.headers.get("retry-after")));
    res = await send();
  }
  return res;
}
