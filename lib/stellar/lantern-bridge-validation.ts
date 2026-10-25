import { StrKey } from "@stellar/stellar-sdk";

export function isStellarPublicKey(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value);
}
