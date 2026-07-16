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

const STATUS: Record<AppErrorCode, number> = {
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
    this.status = STATUS[code];
    this.details = details;
  }
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AppError) {
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
