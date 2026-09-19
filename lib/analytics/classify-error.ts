import { friendlyError, NETWORK_FAILURE, WALLET_REJECTION } from "@/lib/friendly-error";
import type { ErrorClass } from "./events";
import { messageKey } from "./sanitize";

export type ClassifiedError = {
  errorClass: ErrorClass;
  errorCode: string | null;
  messageKey: string;
};

// Order matters: the first match wins, and the specific causes the alpha guide's
// troubleshooting section (§7) names come before the generic buckets.
const RULES: Array<[ErrorClass, RegExp]> = [
  ["user_rejected", WALLET_REJECTION],
  ["user_rejected", /cancelled in your wallet|connection cancelled/i],
  ["wrong_network", /network (passphrase )?mismatch|wrong network|different network/i],
  ["trustline_missing", /trust ?line/i],
  ["account_unfunded", /is not funded|account not found|account .* does not exist/i],
  ["min_balance", /minimum .*xlm required|insufficient balance|underfunded/i],
  ["slippage", /slippage|insufficient ?output/i],
  ["timeout", /timed out|timeout/i],
  ["network", NETWORK_FAILURE],
  ["network", /couldn't reach the network/i],
];

const CODE_CLASSES: Partial<Record<string, ErrorClass>> = {
  RATE_LIMITED: "rate_limited",
  UPSTREAM_RPC: "upstream_rpc",
  VALIDATION: "validation",
  INSUFFICIENT_FUNDS: "min_balance",
};

function rawMessage(err: unknown): string {
  if (err instanceof Error) {
    const details = (err as { details?: unknown }).details;
    return typeof details === "string" ? `${err.message} ${details}` : err.message;
  }
  if (typeof err === "string") return err;
  const body = (err as { error?: { message?: unknown; details?: unknown } } | null)?.error;
  if (body) return [body.message, body.details].filter((v) => typeof v === "string").join(" ");
  return "";
}

function errorCode(err: unknown): string | null {
  const own = (err as { code?: unknown } | null)?.code;
  if (typeof own === "string") return own;
  const body = (err as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof body === "string" ? body : null;
}

/** Bucket any thrown value or API error body for analytics. Never throws. */
export function classifyError(err: unknown, fallback?: string): ClassifiedError {
  const raw = rawMessage(err);
  const code = errorCode(err);
  const errorClass =
    RULES.find(([, re]) => re.test(raw))?.[0] ??
    (code ? CODE_CLASSES[code] : undefined) ??
    "unknown";
  return {
    errorClass,
    errorCode: code,
    messageKey: messageKey(friendlyError(err, fallback).message),
  };
}
