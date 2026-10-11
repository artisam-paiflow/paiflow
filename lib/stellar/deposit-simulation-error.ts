import "server-only";
import { Address, StrKey, type rpc, xdr } from "@stellar/stellar-sdk";
import { SimulationError, simulationFailure } from "./sim-error";
import type { SorobanErrorHint } from "./soroban-errors";

/** The SAC supplies the affected account in its own #13 diagnostic. Never
 * infer sender/recipient from the numeric code or an outer propagated frame.
 * Unknown diagnostic formats retain the neutral simulation explanation.
 * Host source: stellar/rs-soroban-env, stellar_asset_contract/balance.rs,
 * get_trustline_entry ("trustline entry is missing for account"). */
export function depositSimulationFailure(
  sim: rpc.Api.SimulateTransactionErrorResponse,
  hint: SorobanErrorHint | undefined,
  sender: string,
): SimulationError {
  const fallback = simulationFailure(sim.error, hint);
  // Ignore an unrelated earlier diagnostic when this simulation failed for
  // another reason. The same #13 may be propagated through outer frames.
  if (Number(/Error\(Contract,\s*#?(\d+)\)/.exec(sim.error)?.[1]) !== 13) return fallback;
  for (const diagnostic of sim.events) {
    const event = diagnostic.event();
    if (diagnostic.inSuccessfulContractCall() || event.type().name !== "diagnostic") continue;
    const id = event.contractId();
    if (!id) continue;
    const asset = Address.fromScAddress(xdr.ScAddress.scAddressTypeContract(id)).toString();
    if (hint?.addressMap?.[asset] !== "stellar_asset") continue;
    const body = event.body().v0();
    const [topic, error] = body.topics();
    if (
      topic?.switch().name !== "scvSymbol" ||
      topic.sym().toString() !== "error" ||
      error?.switch().name !== "scvError" ||
      error.error().switch().name !== "sceContract" ||
      error.error().contractCode() !== 13
    )
      continue;
    const data = body.data();
    if (data.switch().name !== "scvVec") continue;
    const values = data.vec();
    if (values?.length !== 2) continue;
    const [message, account] = values;
    if (
      message?.switch().name !== "scvString" ||
      message.str().toString() !== "trustline entry is missing for account" ||
      account?.switch().name !== "scvAddress"
    )
      continue;
    const address = Address.fromScVal(account).toString();
    if (!StrKey.isValidEd25519PublicKey(address)) continue;
    const role = address === sender ? "sender" : "recipient";
    const label = hint.assetLabels?.[asset] ?? "this asset";
    return new SimulationError(
      fallback.code,
      `The ${role} (${address}) has no trustline for ${label}. The ${role} must add a trustline for ${label} before this transfer can proceed.`,
      undefined,
      fallback.details,
    );
  }
  return fallback;
}
