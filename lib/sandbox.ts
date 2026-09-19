import { Role, TemplateKind, type Prisma } from "@prisma/client";

/**
 * Constants shared by the sandbox mint, the deploy guard, the crons and their tests.
 *
 * They live here rather than in the routes that use them because a Next.js
 * `route.ts` may only export handlers and route config, and rather than in
 * `lib/sandbox-paths.ts` because that file is imported by `middleware.ts` and
 * must not pull `@prisma/client` into the edge runtime.
 */

/**
 * Stored in `User.passwordHash` for a sandbox account. Not a hash of anything:
 * no password can open the account, only the one-shot ticket the mint returns.
 * Deliberately NOT argon2 over a random string — that would hand an
 * unauthenticated caller a 19 MiB, 2-pass amplifier per request.
 * `verifyPassword()` returns false for a non-PHC string, so the credentials
 * path can never match it (asserted in tests/unit/auth/sandbox-credentials.test.ts).
 */
export const SANDBOX_PASSWORD_SENTINEL = "sandbox:no-password-login";

/**
 * The only contract kinds a SANDBOX session may deploy: every on-chain move in
 * these is signed by the visitor's own wallet, so none of them can draw on the
 * server-held relayer key.
 *
 * A sandbox identity is disposable and needs no account, so it must not be able
 * to create a deployment the platform later signs for. SUBSCRIPTION, PAYROLL,
 * CASH_OUT and STREAMER pipelines are picked up by the `cron/auto-charge-*`,
 * `auto-release` and `process-*-jobs` jobs, which select on status and template
 * kind alone and then sign with STELLAR_RELAYER_SECRET_KEY. WEBHOOK is worse
 * still: `/api/webhooks/:id` is public and signs every call with that key.
 *
 * This is matched against every node of the generated pipeline, not the flow's
 * top-level kind — a `web2_webhook -> swap` graph classifies as SWAPPER but
 * emits a WEBHOOK node, and `devMode` swaps in relayer-admin `*_DEV` variants.
 */
export const SANDBOX_TEMPLATE_KINDS: TemplateKind[] = [
  TemplateKind.SWAPPER,
  TemplateKind.SPLITTER,
  TemplateKind.PAYER,
  TemplateKind.DEPOSIT_TRIGGER,
];

/**
 * How long `cron/poll-events` keeps polling a sandbox-owned deployment. A
 * sandbox account cannot be re-entered once its cookie is gone, and nothing
 * deletes it, so without a bound every sandbox deployment ever made would cost
 * a row read and one `getEvents` per contract on every tick, forever.
 *
 * Not zero: the cron is the only ingester for a deposit made outside the app
 * (the QR / SEP-7 routes are on the sandbox allowlist) and the fallback when
 * `tx-status` misses its ingest deadline, and both happen within hours of a
 * visit. Only the background poll stops — the cursor stays, and the deployment
 * page, its SSE stream and `tx-status` still ingest on demand.
 */
export const SANDBOX_POLL_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The deployments `cron/poll-events` works through on a tick. */
export function cronPollableDeploymentWhere(now: Date): Prisma.DeploymentWhereInput {
  return {
    status: "CONFIRMED",
    // One object under NOT is NOT (a AND b): a row drops out only when it is
    // sandbox-owned and past the window. Every other owner is polled as before.
    NOT: {
      owner: { role: Role.SANDBOX },
      createdAt: { lt: new Date(now.getTime() - SANDBOX_POLL_WINDOW_MS) },
    },
  };
}
