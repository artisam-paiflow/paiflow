import { StrKey } from "@stellar/stellar-sdk";

export type StellarAccountId = string & { readonly __brand: "StellarAccountId" };
export type StellarContractId = string & { readonly __brand: "StellarContractId" };

export function isAccountId(s: unknown): s is StellarAccountId {
  return typeof s === "string" && StrKey.isValidEd25519PublicKey(s);
}

export function isContractId(s: unknown): s is StellarContractId {
  return typeof s === "string" && StrKey.isValidContract(s);
}

export function parseAccountId(s: string): StellarAccountId {
  if (!isAccountId(s)) throw new Error("Invalid Stellar account id");
  return s;
}

export function parseContractId(s: string): StellarContractId {
  if (!isContractId(s)) throw new Error("Invalid Stellar contract id");
  return s;
}
