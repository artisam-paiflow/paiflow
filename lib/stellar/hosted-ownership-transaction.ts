import { Account, Operation, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { assertWalletNetwork } from "@/lib/stellar/wallet-signature";
import type { HostedOwnershipChallenge } from "@/lib/hosted-execution/schema";

export const HOSTED_PROOF_SECONDS = 180;

/** Sequence zero can never execute. This envelope is exclusively a sign-only proof,
 * not a simulated payment or an account-sequence reservation. */
export function hostedOwnershipTransaction(
  payer: string,
  bindingDigest: string,
  networkPassphrase: string,
  minTime: number,
) {
  if (!/^[a-f0-9]{64}$/.test(bindingDigest) || !Number.isSafeInteger(minTime) || minTime < 0)
    throw new Error("Invalid wallet ownership challenge");
  return new TransactionBuilder(new Account(payer, "-1"), {
    fee: "100",
    networkPassphrase,
    timebounds: { minTime, maxTime: minTime + HOSTED_PROOF_SECONDS },
  })
    .addOperation(
      Operation.manageData({ name: "paiflow.hosted-ownership.v1", value: bindingDigest }),
    )
    .build();
}

/** A hostile response must never turn an ownership prompt into a payment prompt. */
export function assertHostedOwnershipChallenge(
  challenge: HostedOwnershipChallenge,
  payer: string,
  network: "testnet" | "mainnet",
) {
  if (challenge.network !== network) throw new Error("Ownership challenge network changed");
  assertWalletNetwork(network, challenge.networkPassphrase);
  const tx = TransactionBuilder.fromXDR(challenge.xdr, challenge.networkPassphrase);
  if (
    !(tx instanceof Transaction) ||
    tx.toEnvelope().switch().name !== "envelopeTypeTx" ||
    tx.signatures.length ||
    !tx.timeBounds
  )
    throw new Error("Invalid wallet ownership challenge");
  const expected = hostedOwnershipTransaction(
    payer,
    challenge.bindingDigest,
    challenge.networkPassphrase,
    Number(tx.timeBounds.minTime),
  );
  if (!tx.hash().equals(expected.hash())) throw new Error("Invalid wallet ownership challenge");
}
