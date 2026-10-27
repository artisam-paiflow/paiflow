import "server-only";
import { AppError } from "@/lib/errors";
import { SimulationError } from "@/lib/stellar/sim-error";
import { MissingPaymentAccountError } from "@/lib/stellar/load-payment-account";
import { EXECUTE_PREREQUISITES } from "./schema";

export function prepareFailure(err: unknown): AppError {
  if (err instanceof MissingPaymentAccountError)
    return new AppError(
      "INSUFFICIENT_FUNDS",
      `The \`from\` account does not exist on this network. ${EXECUTE_PREREQUISITES}`,
    );
  if (err instanceof AppError) {
    // A simulation revert is about this deposit, not the RPC being down: an
    // unfunded `from`, a missing trustline, a pool with no liquidity.
    if (err instanceof SimulationError) {
      return new AppError(
        "VALIDATION",
        `${err.message} ${EXECUTE_PREREQUISITES}`,
        undefined,
        err.details,
      );
    }
    return err;
  }
  return new AppError("UPSTREAM_RPC", "The Soroban RPC request failed; try again");
}
