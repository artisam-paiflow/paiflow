import "server-only";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { interactiveRpcBudgetExpired, remainingInteractiveRpcMs } from "./interactive-rpc-budget";

type Phase =
  | "execution.opening"
  | "execution.getters"
  | "execution.closing"
  | "execution.review"
  | "payment.account"
  | "payment.simulation"
  | "mutation.account"
  | "mutation.simulation";

/** Log only bounded categories and timings, never upstream errors or payloads. */
export async function observeRpcPhase<T>(
  phase: Phase,
  deploymentId: string,
  work: () => Promise<T>,
  attempt?: number,
): Promise<T> {
  const started = Date.now();
  const fields = () => ({
    phase,
    deploymentId,
    attempt,
    elapsedMs: Date.now() - started,
    remainingRpcMs: Number.isFinite(remainingInteractiveRpcMs())
      ? remainingInteractiveRpcMs()
      : null,
  });
  try {
    if (interactiveRpcBudgetExpired())
      throw new AppError(
        "UPSTREAM_RPC",
        "Interactive RPC budget exhausted before preparation completed",
      );
    const result = await work();
    if (interactiveRpcBudgetExpired())
      throw new AppError(
        "UPSTREAM_RPC",
        "Interactive RPC budget exhausted before preparation completed",
      );
    log.info({ ...fields(), outcome: "success" }, "RPC phase completed");
    return result;
  } catch (error) {
    const category = interactiveRpcBudgetExpired()
      ? "deadline"
      : error instanceof AppError
        ? error.code
        : "unavailable";
    log.warn({ ...fields(), outcome: "failure", category }, "RPC phase failed");
    throw error;
  }
}
