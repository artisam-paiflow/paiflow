import "server-only";
import { Address, rpc, scValToNative, StrKey, xdr } from "@stellar/stellar-sdk";
import { SimulationError, simulationFailure } from "./sim-error";

function contractAddress(event: xdr.ContractEvent): string | undefined {
  const id = event.contractId();
  return id ? Address.fromScAddress(xdr.ScAddress.scAddressTypeContract(id)).toString() : undefined;
}

function callTarget(topic: xdr.ScVal | undefined): string | undefined {
  if (topic?.switch().name === "scvBytes") {
    const bytes = topic.bytes();
    return bytes.length === 32 ? StrKey.encodeContract(bytes) : undefined;
  }
  if (topic?.switch().name === "scvAddress") return Address.fromScVal(topic).toString();
  return undefined;
}

/** Attribute the token's allowance error to this subscription's transfer_from,
 * rather than treating an arbitrary nested contract's error #9 as an allowance.
 * Missing or unfamiliar diagnostics retain the existing simulation error.
 */
export function subscriptionChargeFailure(
  sim: rpc.Api.SimulateTransactionErrorResponse,
  subscription: string,
): SimulationError {
  const failure = simulationFailure(sim.error, { contract: "subscription" });
  for (const diagnostic of sim.events) {
    const event = diagnostic.event();
    if (diagnostic.inSuccessfulContractCall() || event.type().name !== "diagnostic") continue;
    const asset = contractAddress(event);
    if (!asset || asset === subscription) continue;
    const body = event.body().v0();
    const [topic, error] = body.topics();
    if (topic?.switch().name !== "scvSymbol" || topic.sym().toString() !== "error") continue;
    if (
      error?.switch().name !== "scvError" ||
      error.error().switch().name !== "sceContract" ||
      error.error().contractCode() !== 9
    )
      continue;
    const data = body.data().switch().name === "scvVec" ? body.data().vec() : null;
    if (
      data?.length !== 3 ||
      data[0]?.switch().name !== "scvString" ||
      data[0].str().toString() !== "not enough allowance to spend" ||
      data[1]?.switch().name !== "scvI128" ||
      data[2]?.switch().name !== "scvI128"
    )
      continue;
    const available = scValToNative(data[1]) as bigint;
    const requested = scValToNative(data[2]) as bigint;
    if (available < 0n || requested <= available) continue;

    const subscriptionTransfer = sim.events.some((callDiagnostic) => {
      const call = callDiagnostic.event();
      if (call.type().name !== "diagnostic" || contractAddress(call) !== subscription) return false;
      const callBody = call.body().v0();
      const [kind, target, fn] = callBody.topics();
      if (
        kind?.switch().name !== "scvSymbol" ||
        kind.sym().toString() !== "fn_call" ||
        callTarget(target) !== asset ||
        fn?.switch().name !== "scvSymbol" ||
        fn.sym().toString() !== "transfer_from"
      )
        return false;
      const args = callBody.data().switch().name === "scvVec" ? callBody.data().vec() : null;
      return (
        args?.length === 4 &&
        args[0]?.switch().name === "scvAddress" &&
        Address.fromScVal(args[0]).toString() === subscription &&
        args[1]?.switch().name === "scvAddress" &&
        args[2]?.switch().name === "scvAddress" &&
        Address.fromScVal(args[2]).toString() === subscription &&
        args[3]?.switch().name === "scvI128" &&
        scValToNative(args[3]) === requested
      );
    });
    if (subscriptionTransfer) {
      return new SimulationError(
        "VALIDATION",
        "Subscription allowance is insufficient for this charge. Ask the configured subscriber to approve more allowance.",
        undefined,
        failure.details,
      );
    }
  }
  return failure;
}
