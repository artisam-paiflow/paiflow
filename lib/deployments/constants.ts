/**
 * How often the deployment page client components re-fetch on-chain events
 * from `/api/deployments/[id]/poll-events`.
 *
 * Two client components on the same page (`deployment-view.tsx` and
 * `live-events.tsx`) each run their own polling loop and import this
 * constant so the rate stays in sync. Per-page effective request rate is
 * roughly `2 / POLL_EVENTS_INTERVAL_MS * 1000` requests per second.
 *
 * Trade-off: lower = snappier live feed at the cost of more RPC calls to
 * Soroban (the route fetches fresh events per request). Bump higher in
 * production if RPC quota becomes a concern.
 */
export const POLL_EVENTS_INTERVAL_MS = 1000;
