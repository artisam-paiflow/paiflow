import "server-only";
import pino from "pino";
import type { Logger } from "pino";
import { env } from "./env";

const REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  "*.password",
  "*.passwordHash",
  "*.signedXdr",
  "*.secretKey",
  "*.AUTH_SECRET",
];

const g = globalThis as unknown as {
  __paiflowLogger?: Logger;
};

function createLogger(): Logger {
  // Pretty-print transport is intentionally not configured here:
  // pino-pretty uses worker_threads, and statically reachable worker scripts
  // break Next.js's production prerender. Pipe `pnpm dev | pino-pretty` in
  // dev for pretty output; production logs go to stdout as JSON.
  return pino({
    level: env().LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    base: { app: "paiflow" },
  });
}

// Keep one pino instance per process. Next.js dev can re-evaluate modules,
// and each fresh pino() attaches listeners to stdout; without this singleton
// we eventually hit MaxListenersExceededWarning.
export const log = g.__paiflowLogger ?? createLogger();
g.__paiflowLogger = log;
