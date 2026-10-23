import "server-only";
import { Address, rpc, StrKey, xdr } from "@stellar/stellar-sdk";
import { SimulationError, simulationFailure } from "./sim-error";

function eventContract(event: xdr.ContractEvent): string | undefined {
  const id = event.contractId();
  return id ? Address.fromScAddress(xdr.ScAddress.scAddressTypeContract(id)).toString() : undefined;
}

function callTarget(value: xdr.ScVal): string | undefined {
  if (value.switch().name === "scvBytes") {
    const bytes = value.bytes();
    return bytes.length === 32 ? StrKey.encodeContract(bytes) : undefined;
  }
  if (value.switch().name === "scvAddress") return Address.fromScVal(value).toString();
  return undefined;
}

/** Called only by the builder for the selected Subscription.subscribe() invocation.
 * Numeric codes and friendly strings are insufficient: both the root call and
 * every failed error frame must establish this target's already-active guard.
 */
export function subscriptionSubscribeFailure(
  sim: rpc.Api.SimulateTransactionErrorResponse,
  subscription: string,
): SimulationError {
  const fallback = simulationFailure(sim.error, { contract: "subscription" });
  if (!/^HostError: Error\(Contract,\s*#?7\)(?:\n|$)/.test(sim.error)) return fallback;

  try {
    let rootCalls = 0;
    let foundGuard = false;
    for (const diagnostic of sim.events) {
      const event = diagnostic.event();
      if (diagnostic.inSuccessfulContractCall() || event.type().name !== "diagnostic") continue;
      const body = event.body().v0();
      const topics = body.topics();
      const topic = topics[0];
      if (topic?.switch().name !== "scvSymbol") return fallback;
      const kind = topic.sym().toString();
      if (kind === "fn_call") {
        const target = topics[1];
        const method = topics[2];
        if (
          event.contractId() ||
          topics.length !== 3 ||
          !target ||
          callTarget(target) !== subscription ||
          method?.switch().name !== "scvSymbol" ||
          method.sym().toString() !== "subscribe" ||
          body.data().switch().name !== "scvVoid"
        )
          return fallback;
        rootCalls += 1;
      }
      if (kind !== "error") continue;
      const error = topics[1];
      if (
        topics.length !== 2 ||
        eventContract(event) !== subscription ||
        error?.switch().name !== "scvError" ||
        error.error().switch().name !== "sceContract" ||
        error.error().contractCode() !== 7
      )
        return fallback;
      foundGuard = true;
    }
    return rootCalls === 1 && foundGuard
      ? new SimulationError(
          "CONFLICT",
          "Subscription is already active",
          undefined,
          fallback.details,
        )
      : fallback;
  } catch {
    // Malformed or unfamiliar diagnostics do not establish a state conflict.
    return fallback;
  }
}
