import "server-only";
import { NetworkError, NotFoundError } from "@stellar/stellar-sdk";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { interactiveRpcBudgetExpired, InteractiveRpcDeadlineError } from "./interactive-rpc-budget";

type PreparationStage = "funding" | "account" | "simulation";

function transportFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    code?: unknown;
    name?: unknown;
    message?: unknown;
    response?: { status?: unknown };
  };
  const status = value.response?.status;
  return (
    error instanceof InteractiveRpcDeadlineError ||
    (error instanceof NetworkError && !(error instanceof NotFoundError)) ||
    (typeof value.message === "string" && /^timeout of [0-9]+ms exceeded$/.test(value.message)) ||
    value.name === "AbortError" ||
    value.name === "TimeoutError" ||
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "ENOTFOUND",
      "EAI_AGAIN",
      "UND_ERR_CONNECT_TIMEOUT",
    ].includes(String(value.code)) ||
    value.message === "fetch failed" ||
    (typeof status === "number" && (status === 408 || status === 429 || status >= 500))
  );
}

export function assertDeploymentPreparationBudget(deploymentId?: string): void {
  if (interactiveRpcBudgetExpired()) {
    log.warn(
      { stage: "preparation", category: "deadline", deploymentId },
      "Deployment preparation unavailable",
    );
    throw new AppError(
      "UPSTREAM_RPC",
      "Deployment preparation exceeded its network deadline. No transaction was submitted; try preparing again.",
    );
  }
}

/** Keep classification around network calls only, never database or audit writes. */
export async function deploymentPreparationRead<T>(
  stage: PreparationStage,
  work: () => Promise<T>,
  deploymentId?: string,
): Promise<T> {
  try {
    assertDeploymentPreparationBudget(deploymentId);
    const result = await work();
    assertDeploymentPreparationBudget(deploymentId);
    return result;
  } catch (error) {
    const upstream = error instanceof AppError && error.code === "UPSTREAM_RPC";
    if (
      !upstream &&
      !transportFailure(error) &&
      !(interactiveRpcBudgetExpired() && !(error instanceof AppError))
    )
      throw error;
    log.warn(
      { stage, category: interactiveRpcBudgetExpired() ? "deadline" : "upstream", deploymentId },
      "Deployment preparation unavailable",
    );
    throw new AppError(
      "UPSTREAM_RPC",
      `The Stellar network could not complete deployment ${stage}. No transaction was submitted; try preparing again.`,
    );
  }
}
