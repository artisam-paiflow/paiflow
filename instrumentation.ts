export async function register() {
  if (!process.env.SENTRY_DSN) return;
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initSentryServer } = await import("./sentry.server.config");
    await initSentryServer();
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    const { initSentryEdge } = await import("./sentry.edge.config");
    await initSentryEdge();
  }
}
