import "server-only";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { interactiveRpcBudgetExpired } from "./interactive-rpc-budget";

/** Wrap only RPC/SDK dispatch and assembly, never eligibility, contract errors or durable writes. */
export async function allowanceRpcCall<T>(
  operation: "getLatestLedger" | "simulateTransaction" | "assembleTransaction",
  work: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await work();
  } catch {
    // Provider errors can include credentials or envelopes; log only safe metadata.
    log.warn(
      {
        operation,
        category: interactiveRpcBudgetExpired() ? "deadline" : "upstream",
        elapsedMs: Math.max(0, Date.now() - startedAt),
      },
      "Allowance preparation RPC failed",
    );
    throw new AppError(
      "UPSTREAM_RPC",
      "The Stellar RPC could not prepare this approval; try preparing again",
    );
  }
}
