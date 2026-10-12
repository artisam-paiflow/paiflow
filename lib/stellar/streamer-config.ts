import "server-only";
import { Address, StrKey, scValToNative, xdr } from "@stellar/stellar-sdk";
import { AppError } from "@/lib/errors";
import { sorobanRpc } from "./client";

/** STREAMER exposes neither admin() nor asset(). Read only these instance fields. */
export async function readStreamerConfig(
  contractId: string,
): Promise<{ admin: string; asset: string }> {
  if (!StrKey.isValidContract(contractId))
    throw new AppError("VALIDATION", "Invalid Schedule contract");
  try {
    const key = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: new Address(contractId).toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    );
    const result = await sorobanRpc().getLedgerEntries(key);
    if (
      !Number.isInteger(result.latestLedger) ||
      result.latestLedger <= 0 ||
      result.entries.length !== 1 ||
      !result.entries[0]!.key.toXDR().equals(key.toXDR())
    )
      throw new Error();
    const storage = result.entries[0]!.val.contractData().val().instance().storage() ?? [];
    const read = (name: string): string => {
      const fields = storage.filter((entry) => {
        const native: unknown = scValToNative(entry.key());
        return Array.isArray(native) && native.length === 1 && native[0] === name;
      });
      if (fields.length !== 1 || fields[0]!.val().switch().name !== "scvAddress") throw new Error();
      const value: unknown = scValToNative(fields[0]!.val());
      if (typeof value !== "string") throw new Error();
      return value;
    };
    const admin = read("Admin");
    const asset = read("Asset");
    if (
      !(StrKey.isValidEd25519PublicKey(admin) || StrKey.isValidContract(admin)) ||
      !StrKey.isValidContract(asset)
    )
      throw new Error();
    return { admin, asset };
  } catch {
    throw new AppError("UPSTREAM_RPC", "Current Schedule controller and asset could not be read");
  }
}
