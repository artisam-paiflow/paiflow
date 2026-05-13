import "server-only";
import pino from "pino";
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

// Pretty-print transport is intentionally not configured here:
// pino-pretty uses worker_threads, and statically reachable worker scripts
// break Next.js's production prerender. Pipe `pnpm dev | pino-pretty` in
// dev for pretty output; production logs go to stdout as JSON.
export const log = pino({
  level: env().LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  base: { app: "pinkraft" },
});
