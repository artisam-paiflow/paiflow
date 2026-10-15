import { Keypair, Networks, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";

/** Validate the server-supplied passphrase; never replace it with a client default. */
export function assertWalletNetwork(network: "testnet" | "mainnet", passphrase: string): void {
  if (passphrase !== (network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET)) {
    throw new Error("Wallet and transaction networks do not match.");
  }
}

/** Only accept the prepared body, preserved signatures, and this wallet's signature. */
export function assertSignedWalletTransaction(
  originalXdr: string,
  signedXdr: string,
  address: string,
  networkPassphrase: string,
): void {
  const original = TransactionBuilder.fromXDR(originalXdr, networkPassphrase);
  const signed = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  if (!(original instanceof Transaction) || !(signed instanceof Transaction)) {
    throw new Error("Wallet returned an unsupported transaction envelope.");
  }
  if (original.source !== address || !original.hash().equals(signed.hash())) {
    throw new Error("Wallet changed the prepared transaction.");
  }
  const remaining = signed.signatures.map((signature) => signature.toXDR("base64"));
  for (const signature of original.signatures) {
    const index = remaining.indexOf(signature.toXDR("base64"));
    if (index < 0) throw new Error("Wallet removed an existing transaction signature.");
    remaining.splice(index, 1);
  }
  const key = Keypair.fromPublicKey(address);
  const hash = signed.hash();
  if (!signed.signatures.some((signature) => key.verify(hash, signature.signature()))) {
    throw new Error("Wallet did not sign with the connected account on the requested network.");
  }
}
