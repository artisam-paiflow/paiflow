export async function initSentryEdge(): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  // eslint-disable-next-line no-console
  console.warn("[sentry] SENTRY_DSN is set but @sentry/nextjs is not installed; skipping init.");
}
