/**
 * The sandbox allowlist enforced by middleware.ts. A SANDBOX session is a throwaway
 * identity anyone on the internet can mint, so the surfaces it reaches are
 * enumerated rather than subtracted — this test is the record of that list.
 */
import { describe, expect, it } from "vitest";
import { isSandboxAllowed } from "@/lib/sandbox-paths";

const DEPLOYMENT = "22222222-2222-2222-2222-222222222222";
const FLOW = "33333333-3333-3333-3333-333333333333";

const ALLOWED = [
  "/",
  "/dashboard",
  `/flows/${FLOW}`,
  `/flows/${FLOW}/deploy`,
  `/deployments/${DEPLOYMENT}`,
  `/deployments/${DEPLOYMENT}/embed`,
  `/trigger/${DEPLOYMENT}`,
  "/api/auth/sandbox",
  "/api/auth/session",
  "/api/auth/csrf",
  "/api/auth/signout",
  // Where a deactivated sandbox account's cookie gets cleared.
  "/api/auth/stale-session",
  "/api/auth/callback/credentials",
  "/api/health",
  "/api/flows",
  "/api/flows/new",
  "/api/address-book",
  `/api/flows/${FLOW}`,
  `/api/flows/${FLOW}/validate`,
  `/api/flows/${FLOW}/preview`,
  `/api/flows/${FLOW}/resolve-addresses`,
  "/api/soroswap/quote",
  "/api/deployments",
  "/api/deployments/prepare",
  `/api/deployments/${DEPLOYMENT}`,
  `/api/deployments/${DEPLOYMENT}/submit`,
  `/api/deployments/${DEPLOYMENT}/status`,
  `/api/deployments/${DEPLOYMENT}/events`,
  `/api/deployments/${DEPLOYMENT}/balances`,
  `/api/deployments/${DEPLOYMENT}/trigger`,
  `/api/deployments/${DEPLOYMENT}/submit-trigger`,
  // Polled by `usePollTxStatus` after every trigger; it verifies the txHash
  // belongs to this deployment inside the route.
  `/api/deployments/${DEPLOYMENT}/tx-status`,
  `/api/deployments/${DEPLOYMENT}/sep7`,
  `/api/deployments/${DEPLOYMENT}/qr`,
];

const BLOCKED = [
  // Account and admin surface: a disposable identity has nothing to manage.
  "/account",
  "/account/address-book",
  "/admin",
  "/admin/users",
  "/admin/offramp",
  "/api/account/password",
  "/api/account/passkeys",
  "/api/admin/users",
  "/api/admin/audit-log",
  "/api/auth/sessions/revoke-all",
  "/api/auth/register",
  "/api/auth/password-reset",
  "/api/auth/passkey/register/options",
  // The /api/deployments/:id/* routes with no ownership check. Reachable by any
  // signed-in user today; not widened to callers with no account. `tx-status`
  // left this list once it started binding the txHash to the deployment.
  `/api/deployments/${DEPLOYMENT}/invoke`,
  `/api/deployments/${DEPLOYMENT}/submit-invoke`,
  `/api/deployments/${DEPLOYMENT}/streamer-state`,
  // Billed AI provider calls.
  `/api/flows/${FLOW}/edit`,
  "/api/transcribe",
  // Machine-auth and money-moving automation, public in PUBLIC_PATHS but not
  // for a sandbox session.
  `/api/deployments/${DEPLOYMENT}/dev-config`,
  `/api/deployments/${DEPLOYMENT}/dev-splitter`,
  `/api/deployments/${DEPLOYMENT}/payroll-allowance`,
  `/api/deployments/${DEPLOYMENT}/payroll-charge`,
  `/api/deployments/${DEPLOYMENT}/offramp-enable`,
  `/api/deployments/${DEPLOYMENT}/subscription-charge`,
  "/api/deployments/dev-payroll",
  "/api/cron/poll-events",
  "/api/webhooks/offramp",
  // Minting and revoking partner API tokens, and the partner API itself.
  `/api/deployments/${DEPLOYMENT}/api-tokens`,
  `/api/deployments/${DEPLOYMENT}/api-tokens/${FLOW}`,
  "/api/v1",
  `/api/v1/deployments/${DEPLOYMENT}/execute`,
  `/api/v1/deployments/${DEPLOYMENT}/events`,
  // File upload and storage.
  "/api/files",
  `/api/files/${DEPLOYMENT}`,
  // Other owner surfaces.
  `/payroll/${DEPLOYMENT}/employees`,
  // A non-uuid segment must never satisfy an `:id` rule.
  "/api/deployments/prepare/../dev-payroll",
  "/flows/new",
  `/allowance/${DEPLOYMENT}`,
];

describe("isSandboxAllowed", () => {
  it.each(ALLOWED)("allows %s", (path) => {
    expect(isSandboxAllowed(path)).toBe(true);
  });

  it.each(BLOCKED)("blocks %s", (path) => {
    expect(isSandboxAllowed(path)).toBe(false);
  });
});
