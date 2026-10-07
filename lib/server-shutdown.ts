import "server-only";
import { log } from "@/lib/log";

// Instrumentation and route handlers can be separate webpack bundles. Keep the
// registry on globalThis so both own the same process lifecycle (also under HMR).
const shared = globalThis as typeof globalThis & {
  paiflowShutdown?: {
    started: boolean;
    installed: boolean;
    callbacks: Set<() => void>;
  };
};
const state = (shared.paiflowShutdown ??= {
  started: false,
  installed: false,
  callbacks: new Set(),
});

export function isShuttingDown() {
  return state.started;
}

export function onServerShutdown(callback: () => void): () => void {
  if (state.started) {
    callback();
    return () => {};
  }
  state.callbacks.add(callback);
  return () => state.callbacks.delete(callback);
}

export function beginServerShutdown() {
  if (state.started) return;
  state.started = true;
  const callbacks = [...state.callbacks];
  state.callbacks.clear();
  for (const callback of callbacks) {
    try {
      callback();
    } catch (err) {
      log.error({ err }, "Server shutdown cleanup failed");
    }
  }
}

export function installServerShutdown() {
  if (state.installed) return;
  state.installed = true;
  // Next 15.5's start-server waits for server.close() before nextServer.close()
  // and process.exit(0). Close streaming responses before that wait begins;
  // leave HTTP draining and process exit to Next's existing signal handler.
  process.prependListener("SIGTERM", beginServerShutdown);
  process.prependListener("SIGINT", beginServerShutdown);
}
