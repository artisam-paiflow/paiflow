import "server-only";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { SimulationError } from "./sim-error";
import { interactiveRpcBudgetExpired } from "./interactive-rpc-budget";

/** Only fixed categories are logged: provider errors can contain credentials or XDR. */
export function scheduleReadFailure(
  stage: string,
  category: string,
  startedAt = Date.now(),
): AppError {
  log.warn(
    { operation: "schedule.read", stage, category, elapsedMs: Math.max(0, Date.now() - startedAt) },
    "Schedule RPC read unavailable",
  );
  return new AppError(
    "UPSTREAM_RPC",
    "Current Schedule data could not be verified. Please try again.",
  );
}

export function assertScheduleRpcBudget(): void {
  if (interactiveRpcBudgetExpired()) throw scheduleReadFailure("deadline", "deadline");
}

export async function scheduleRpcRead<T>(stage: string, work: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  assertScheduleRpcBudget();
  try {
    const result = await work();
    assertScheduleRpcBudget();
    return result;
  } catch (error) {
    if (error instanceof SimulationError) throw error;
    if (error instanceof AppError && error.code !== "UPSTREAM_RPC") throw error;
    const value = error as {
      code?: unknown;
      name?: unknown;
      response?: { status?: unknown };
    } | null;
    const code = value?.code;
    const category =
      interactiveRpcBudgetExpired() || code === "RPC_DEADLINE"
        ? "deadline"
        : ["ECONNABORTED", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(String(code)) ||
            value?.name === "TimeoutError"
          ? "timeout"
          : value?.name === "AbortError"
            ? "aborted"
            : ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(String(code))
              ? "network"
              : typeof value?.response?.status === "number"
                ? "http"
                : typeof code === "number"
                  ? "json_rpc"
                  : "upstream";
    throw scheduleReadFailure(stage, category, startedAt);
  }
}
