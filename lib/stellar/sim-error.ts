import "server-only";
import { AppError } from "@/lib/errors";
import { translateSorobanError, type SorobanErrorHint } from "./soroban-errors";

/**
 * A simulation the network ran and the contract reverted, as distinct from an
 * RPC that could not be reached. Callers that treat a revert as the caller's
 * input problem test for this class rather than parsing `details`.
 */
export class SimulationError extends AppError {}

/**
 * Build an AppError for a failed Soroban simulation. The user-facing message
 * is the translated friendly text; the raw diagnostic dump is preserved in
 * `details` so the UI can expose it behind a "show details" affordance.
 */
export function simulationFailure(raw: string, hint?: SorobanErrorHint): SimulationError {
  const t = translateSorobanError(raw, hint);
  return new SimulationError(
    "UPSTREAM_RPC",
    t.friendly,
    undefined,
    `Soroban simulate failed: ${raw}`,
  );
}
