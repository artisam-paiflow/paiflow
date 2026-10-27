import "server-only";
import { Address, StrKey, scValToNative, xdr } from "@stellar/stellar-sdk";
import { AppError } from "@/lib/errors";
import { sorobanRpc } from "./client";
import { withInteractiveRpcBudget } from "./interactive-rpc-budget";
import { scheduleReadFailure, scheduleRpcRead } from "./schedule-rpc";

/** STREAMER exposes neither admin() nor asset(). Read only these instance fields. */
export async function readStreamerConfig(
  contractId: string,
): Promise<{ admin: string; asset: string }> {
  if (!StrKey.isValidContract(contractId))
    throw new AppError("VALIDATION", "Invalid Schedule contract");
  return withInteractiveRpcBudget(async () => {
    const key = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: new Address(contractId).toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    );
    // Keep malformed raw entries distinct from a successful lookup proving absence.
    // The SDK parsed reader normalizes entries:null into an empty list.
    const result: unknown = await scheduleRpcRead("configuration.lookup", () =>
      sorobanRpc()._getLedgerEntries(key),
    );
    if (
      !result ||
      typeof result !== "object" ||
      !("latestLedger" in result) ||
      typeof result.latestLedger !== "number" ||
      !Number.isInteger(result.latestLedger) ||
      result.latestLedger <= 0 ||
      result.latestLedger > 0xffff_ffff ||
      ("entries" in result && result.entries !== undefined && !Array.isArray(result.entries))
    )
      throw scheduleReadFailure("configuration.response", "invalid_response");
    const entries = "entries" in result ? result.entries : undefined;
    if (entries === undefined || (Array.isArray(entries) && entries.length === 0))
      throw scheduleReadFailure("configuration.response", "missing_entry");
    if (!Array.isArray(entries) || entries.length !== 1)
      throw scheduleReadFailure("configuration.response", "invalid_response");
    const entry: unknown = entries[0];
    if (
      !entry ||
      typeof entry !== "object" ||
      !("key" in entry) ||
      typeof entry.key !== "string" ||
      !("xdr" in entry) ||
      typeof entry.xdr !== "string"
    )
      throw scheduleReadFailure("configuration.response", "invalid_response");
    let storage: xdr.ScMapEntry[];
    try {
      const returnedKey = xdr.LedgerKey.fromXDR(entry.key, "base64");
      if (!returnedKey.toXDR().equals(key.toXDR()))
        throw scheduleReadFailure("configuration.key", "mismatched_key");
      const data = xdr.LedgerEntryData.fromXDR(entry.xdr, "base64").contractData();
      if (
        !data.contract().toXDR().equals(key.contractData().contract().toXDR()) ||
        !data.key().toXDR().equals(key.contractData().key().toXDR()) ||
        data.durability().name !== "persistent"
      )
        throw scheduleReadFailure("configuration.storage", "invalid_storage");
      storage = data.val().instance().storage() ?? [];
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw scheduleReadFailure("configuration.storage", "invalid_storage");
    }
    const read = (name: string): string => {
      const fields = storage.filter((entry) => {
        const fieldKey = entry.key();
        if (fieldKey.switch().name !== "scvVec") return false;
        const variant = fieldKey.vec();
        return (
          variant?.length === 1 &&
          variant[0]?.switch().name === "scvSymbol" &&
          variant[0].sym().toString() === name
        );
      });
      if (fields.length !== 1 || fields[0]!.val().switch().name !== "scvAddress") throw new Error();
      const value: unknown = scValToNative(fields[0]!.val());
      if (typeof value !== "string") throw new Error();
      return value;
    };
    let admin: string;
    let asset: string;
    try {
      admin = read("Admin");
      asset = read("Asset");
    } catch {
      throw scheduleReadFailure("configuration.fields", "invalid_storage");
    }
    if (
      !(StrKey.isValidEd25519PublicKey(admin) || StrKey.isValidContract(admin)) ||
      !StrKey.isValidContract(asset)
    )
      throw scheduleReadFailure("configuration.addresses", "invalid_storage");
    return { admin, asset };
  });
}
