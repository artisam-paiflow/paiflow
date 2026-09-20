/**
 * Everything a SANDBOX-role session may reach: the builder, the deploy flow and
 * the read-only deployment views.
 *
 * A sandbox identity is disposable and anyone on the internet can mint one
 * (`POST /api/auth/sandbox`), so the reachable surface is an allowlist rather
 * than a blocklist — most of the app is owner-scoped account, admin or machine
 * surface such an account has no business touching. `middleware.ts` checks this
 * ahead of its own PUBLIC_PATHS shortcut, because several machine-auth
 * endpoints are public there and must still be closed to a sandbox session.
 *
 * Deliberately omitted:
 *  - `/api/flows/:id/edit` and `/api/transcribe` bill a third-party AI
 *    provider, and their per-user rate limits would not hold behind a fresh
 *    identity every session.
 *  - `invoke`, `submit-invoke` and `streamer-state` look up a deployment by id
 *    WITHOUT an ownership check. That is a pre-existing gap; do not widen its
 *    blast radius to callers who never signed up. Deploy-and-trigger does not
 *    need them — `submit-invoke` is only used by the subscription/payroll
 *    allowance flow, which a sandbox session cannot deploy anyway (see
 *    `app/api/deployments/prepare/route.ts`).
 *  - `/api/v1/*` is the partner API, a machine surface for a deployment token
 *    an owner chose to mint. A sandbox identity is disposable; nothing it does
 *    should reach a surface built for credentials that outlive a session.
 *
 * `tx-status` used to sit in that list and no longer does. Its answer is a
 * transaction's status on a public chain, for a hash the caller already holds,
 * so there was never anything there to own; what needed binding to the
 * deployment was the bookkeeping it runs on a confirmation, and that now checks
 * `wasTxSubmittedFor` before it touches anything. Deploy-and-trigger genuinely
 * needs the route — `usePollTxStatus` is how the trigger button learns the
 * deposit confirmed.
 *
 * No module in this file may import `server-only`; middleware runs on the edge
 * runtime.
 */
// Route ids are uuids everywhere in this app (Flow.id, Deployment.id), so the
// id segment is matched as one instead of `[^/]+`. That is what keeps a literal
// sibling route such as `/api/deployments/dev-payroll` — a relayer-funded
// deploy — from slipping through the `/api/deployments/:id` rule, now and as
// new sibling routes get added.
const ID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

const SANDBOX_PATHS = [
  /^\/$/,
  /^\/dashboard$/,
  new RegExp(`^/flows/${ID}$`),
  new RegExp(`^/flows/${ID}/deploy$`),
  new RegExp(`^/deployments/${ID}$`),
  new RegExp(`^/deployments/${ID}/embed$`),
  new RegExp(`^/trigger/${ID}$`),

  // Auth.js's own endpoints plus the sandbox mint. Enumerated rather than
  // `/api/auth/*`: that prefix also holds registration, password reset, passkey
  // enrolment and session revocation, none of which a throwaway account needs.
  /^\/api\/auth\/(session|csrf|providers|signin|signout|error)$/,
  /^\/api\/auth\/(signin|callback)\/credentials$/,
  /^\/api\/auth\/sandbox$/,
  // Deactivating is the only lever an admin has over a sandbox account, and it
  // leaves the visitor holding a cookie that still says SANDBOX to middleware.
  // Without this entry the redirect that clears that cookie is answered with
  // the sandbox 403 instead. The route can only sign its own caller out.
  /^\/api\/auth\/stale-session$/,

  /^\/api\/health$/,
  /^\/api\/flows$/,
  /^\/api\/flows\/new$/,
  new RegExp(`^/api/flows/${ID}$`),
  new RegExp(`^/api/flows/${ID}/(preview|validate|resolve-addresses)$`),
  /^\/api\/address-book(\/[^/]+)?$/,
  /^\/api\/soroswap\/quote$/,
  /^\/api\/audit\/wallet-connection$/,
  /^\/api\/deployments$/,
  /^\/api\/deployments\/prepare$/,
  new RegExp(`^/api/deployments/${ID}$`),
  new RegExp(
    `^/api/deployments/${ID}/(submit|submit-trigger|trigger|tx-status|status|events|poll-events|balances|sep7|qr)$`,
  ),
];

export function isSandboxAllowed(pathname: string): boolean {
  return SANDBOX_PATHS.some((re) => re.test(pathname));
}
