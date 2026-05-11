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

export const log = pino({
  level: env().LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  base: { app: "pinkraft" },
  ...(env().NODE_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});
