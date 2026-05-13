// Minimal Sentry hook. The repo ships without @sentry/nextjs to keep the
// build graph small; if you want it, `pnpm add @sentry/nextjs` then replace
// the body of this function with `Sentry.init({...})`. The instrumentation
// wrapper in instrumentation.ts already gates the call on SENTRY_DSN.
export async function initSentryServer(): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  // eslint-disable-next-line no-console
  console.warn("[sentry] SENTRY_DSN is set but @sentry/nextjs is not installed; skipping init.");
}
