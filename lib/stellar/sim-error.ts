import "server-only";
import { AppError } from "@/lib/errors";
import { translateSorobanError, type SorobanErrorHint } from "./soroban-errors";

/**
 * Build an AppError for a failed Soroban simulation. The user-facing message
 * is the translated friendly text; the raw diagnostic dump is preserved in
 * `details` so the UI can expose it behind a "show details" affordance.
 */
export function simulationFailure(raw: string, hint?: SorobanErrorHint): AppError {
  const t = translateSorobanError(raw, hint);
  return new AppError("UPSTREAM_RPC", t.friendly, undefined, `Soroban simulate failed: ${raw}`);
}
