import "server-only";
import {
  Address,
  BASE_FEE,
  Contract,
  StrKey,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { z } from "zod";
import { stellarPassphrase, stellarRelayerAddress } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { sorobanRpc } from "@/lib/stellar/client";

const address = z
  .string()
  .refine((value) => StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value));
const SubscriptionStateSchema = z
  .object({
    isCancelled: z.boolean(),
    nextChargeAt: z
      .bigint()
      .min(0n)
      .max((1n << 64n) - 1n),
    amountPerPeriod: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .refine((value) => BigInt(value) <= (1n << 127n) - 1n),
    subscriber: address,
    asset: z.string().refine(StrKey.isValidContract),
    relayer: address,
  })
  .strict();
export type SubscriptionState = z.infer<typeof SubscriptionStateSchema>;

const fields = {
  is_cancelled: "scvBool",
  next_charge_at: "scvU64",
  amount_per_period: "scvI128",
  subscriber: "scvAddress",
  asset: "scvAddress",
  relayer: "scvAddress",
} as const;

/** Reject unexpected wire types before native decoding (e.g. address-like strings). */
export function decodeSubscriptionState(retval: xdr.ScVal): SubscriptionState {
  try {
    if (retval.switch().name !== "scvMap") throw new Error();
    const entries = retval.map();
    if (!entries || entries.length !== Object.keys(fields).length) throw new Error();
    const values = new Map<string, unknown>();
    for (const entry of entries) {
      if (entry.key().switch().name !== "scvSymbol") throw new Error();
      const key = entry.key().sym().toString();
      if (!Object.hasOwn(fields, key) || values.has(key)) throw new Error();
      if (entry.val().switch().name !== fields[key as keyof typeof fields]) throw new Error();
      values.set(key, scValToNative(entry.val()));
    }
    const amount = values.get("amount_per_period");
    if (typeof amount !== "bigint") throw new Error();
    return SubscriptionStateSchema.parse({
      isCancelled: values.get("is_cancelled"),
      nextChargeAt: values.get("next_charge_at"),
      amountPerPeriod: amount.toString(),
      subscriber: values.get("subscriber"),
      asset: values.get("asset"),
      relayer: values.get("relayer"),
    });
  } catch {
    throw new AppError("UPSTREAM_RPC", "Subscription state response is malformed");
  }
}

/** Host diagnostic proves the *requested* export is absent, rather than missing storage. */
function isUnsupportedState(
  sim: rpc.Api.SimulateTransactionErrorResponse,
  contractAddress: string,
): boolean {
  if (!/^HostError: Error\(WasmVm, MissingValue\)(?:\n|$)/.test(sim.error)) return false;
  return sim.events.some((diagnostic) => {
    const event = diagnostic.event();
    if (event.type().name !== "diagnostic" || !event.contractId()) return false;
    if (
      Address.fromScAddress(xdr.ScAddress.scAddressTypeContract(event.contractId()!)).toString() !==
      contractAddress
    )
      return false;
    const body = event.body().v0();
    const [topic, error] = body.topics();
    if (topic?.switch().name !== "scvSymbol" || topic.sym().toString() !== "error") return false;
    if (error?.switch().name !== "scvError") return false;
    if (
      error.error().switch().name !== "sceWasmVm" ||
      error.error().code().name !== "scecMissingValue"
    )
      return false;
    if (body.data().switch().name !== "scvVec") return false;
    const data = body.data().vec();
    return (
      data?.length === 2 &&
      data[0]?.switch().name === "scvString" &&
      data[0].str().toString() === "trying to invoke non-existent contract function" &&
      data[1]?.switch().name === "scvSymbol" &&
      data[1].sym().toString() === "state"
    );
  });
}

/** Workflow-scoped negative capability only. Never cache mutable state or persist capability.
 * Create a new reader each cron run so network/executable changes are probed again.
 */
export function createSubscriptionStateReader() {
  const unsupported = new Set<string>();
  return async (contractAddress: string): Promise<SubscriptionState | null> => {
    if (unsupported.has(contractAddress)) return null;
    const source = stellarRelayerAddress();
    if (!source) throw new AppError("INTERNAL", "STELLAR_RELAYER_ADDRESS is not configured");
    const server = sorobanRpc();
    let sim: rpc.Api.SimulateTransactionResponse;
    try {
      const account = await server.getAccount(source);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: stellarPassphrase(),
      })
        .addOperation(new Contract(contractAddress).call("state"))
        .setTimeout(180)
        .build();
      sim = await server.simulateTransaction(tx);
    } catch {
      throw new AppError("UPSTREAM_RPC", "Subscription state RPC request failed");
    }
    if (rpc.Api.isSimulationError(sim)) {
      if (isUnsupportedState(sim, contractAddress)) {
        unsupported.add(contractAddress);
        return null;
      }
      // Fixed messages also avoid the cron's legacy substring-based skip classifier.
      throw new AppError("UPSTREAM_RPC", "Subscription state simulation failed");
    }
    if (rpc.Api.isSimulationRestore(sim))
      throw new AppError("UPSTREAM_RPC", "Subscription state requires restoration");
    if (!sim.result?.retval)
      throw new AppError("UPSTREAM_RPC", "Subscription state response is missing");
    return decodeSubscriptionState(sim.result.retval);
  };
}
