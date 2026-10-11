import "server-only";
import { Address, rpc, xdr } from "@stellar/stellar-sdk";
import { CONTRACT_ERRORS } from "./soroban-errors";
import { SimulationError, simulationFailure } from "./sim-error";

/** Classify only this Streamer's own pause guard. A nested contract can reuse
 * error 10 and propagate it through the Streamer, so every failed error frame
 * must agree on the target and code. Missing diagnostics retain the fallback.
 */
export function streamerRetrieveFailure(
  sim: rpc.Api.SimulateTransactionErrorResponse,
  streamer: string,
): SimulationError {
  const failure = simulationFailure(sim.error, { contract: "streamer" });
  if (!/^HostError: Error\(Contract,\s*#?10\)/.test(sim.error)) return failure;

  let foundGuard = false;
  for (const diagnostic of sim.events) {
    const event = diagnostic.event();
    if (diagnostic.inSuccessfulContractCall() || event.type().name !== "diagnostic") continue;
    const [topic, error] = event.body().v0().topics();
    if (topic?.switch().name !== "scvSymbol" || topic.sym().toString() !== "error") continue;
    const id = event.contractId();
    if (
      !id ||
      Address.fromScAddress(xdr.ScAddress.scAddressTypeContract(id)).toString() !== streamer ||
      error?.switch().name !== "scvError" ||
      error.error().switch().name !== "sceContract" ||
      error.error().contractCode() !== 10
    )
      return failure;
    foundGuard = true;
  }
  return foundGuard
    ? new SimulationError(
        "CONFLICT",
        CONTRACT_ERRORS.streamer[10]!.friendly,
        undefined,
        failure.details,
      )
    : failure;
}
