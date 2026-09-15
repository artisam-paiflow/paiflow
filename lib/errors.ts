import { ZodError } from "zod";
import { NextResponse } from "next/server";
import { log } from "./log";

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "UPSTREAM_RPC"
  | "INSUFFICIENT_FUNDS"
  | "INTERNAL";

/** The one place a code maps to an HTTP status; the OpenAPI document reads it too. */
export const APP_ERROR_STATUS: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UPSTREAM_RPC: 502,
  INSUFFICIENT_FUNDS: 402,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly fields?: Record<string, string[]>;
  readonly status: number;
  /** Raw technical detail (e.g. a Soroban diagnostic dump) for the UI to
   * expose behind a "show details" affordance. Never shown by default. */
  readonly details?: string;

  constructor(
    code: AppErrorCode,
    message: string,
    fields?: Record<string, string[]>,
    details?: string,
  ) {
    super(message);
    this.code = code;
    this.fields = fields;
    this.status = APP_ERROR_STATUS[code];
    this.details = details;
  }
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AppError) {
    // A 5xx AppError is a real failure the operator has to be able to see. It
    // used to return in silence, so an UPSTREAM_RPC from a failed Soroban
    // simulation left nothing in the logs at all and the only evidence was a
    // 502 in the edge access log.
    //
    // `message` is deliberately NOT logged: it is where raw upstream text ends
    // up (`lib/ai/groq.ts` interpolates a provider response body and model
    // output straight into it), and nothing here can scrub a free-text string —
    // pino's redact list is path-based. `details` is safe by construction: the
    // only place that sets it is `lib/stellar/sim-error.ts`, whose payload is a
    // Soroban diagnostic dump — contract addresses, error codes, ledger state,
    // all public on-chain data — and it is the one thing worth reading when a
    // simulation fails. Truncated because those dumps run to tens of kilobytes.
    // Anything else still leaves a code and a status, so no 5xx is silent.
    if (err.status >= 500) {
      log.error(
        { code: err.code, status: err.status, details: err.details?.slice(0, 2000) },
        "request failed",
      );
    }
    return NextResponse.json(
      { error: { code: err.code, message: err.message, fields: err.fields, details: err.details } },
      { status: err.status },
    );
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const k = issue.path.join(".") || "_";
      (fields[k] ??= []).push(issue.message);
    }
    return NextResponse.json(
      { error: { code: "VALIDATION", message: "Invalid input", fields } },
      { status: 422 },
    );
  }
  // Prisma known errors mapping (string match to avoid hard dep on namespace)
  const code = (err as { code?: string })?.code;
  if (code === "P2002") {
    return NextResponse.json(
      { error: { code: "CONFLICT", message: "Resource already exists" } },
      { status: 409 },
    );
  }
  if (code === "P2025") {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Resource not found" } },
      { status: 404 },
    );
  }
  log.error({ err }, "unhandled error");
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Internal server error" } },
    { status: 500 },
  );
}

export async function withErrorHandler<T>(fn: () => Promise<T>): Promise<T | NextResponse> {
  try {
    return await fn();
  } catch (err) {
    return errorResponse(err);
  }
}
