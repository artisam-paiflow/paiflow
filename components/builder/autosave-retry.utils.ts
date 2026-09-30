/** Attempts after the first one; a 429 that outlasts them is reported like any failed save. */
export const MAX_RATE_LIMIT_RETRIES = 3;
export const RETRY_FALLBACK_MS = 3_000;
export const RETRY_MAX_WAIT_MS = 30_000;

/** `Retry-After` in seconds (the only form the API sends) as a bounded delay in ms. */
export function retryAfterMs(header: string | null): number {
  const seconds = header === null || header.trim() === "" ? NaN : Number(header.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return RETRY_FALLBACK_MS;
  return Math.min(Math.max(seconds * 1000, 250), RETRY_MAX_WAIT_MS);
}

export type RetryOptions = {
  sleep?: (ms: number) => Promise<void>;
  /** Checked after every wait: true means a newer save took over, so stop without sending. */
  superseded?: () => boolean;
  maxRetries?: number;
};

/**
 * Run `send`; on HTTP 429 wait out `Retry-After` and run it again, up to `maxRetries`
 * (MAX_RATE_LIMIT_RETRIES) times. Any other status (4xx included) is returned at once. `send` is
 * called afresh each time so it can read the newest state instead of resending a stale body.
 * Returns null when `superseded` turned true during a wait.
 */
export async function sendWithRateLimitRetry(
  send: () => Promise<Response>,
  opts: RetryOptions = {},
): Promise<Response | null> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = opts.maxRetries ?? MAX_RATE_LIMIT_RETRIES;
  let res = await send();
  for (let i = 0; i < maxRetries && res.status === 429; i++) {
    await sleep(retryAfterMs(res.headers.get("retry-after")));
    if (opts.superseded?.()) return null;
    res = await send();
  }
  return res;
}
