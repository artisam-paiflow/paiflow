import { Account, Operation, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  ConditionalHostedOwnershipChallengeSchema,
  type ConditionalHostedOwnershipChallenge,
  type ConditionalHostedOwnershipRequest,
} from "@/lib/hosted-execution/conditional-schema";
import { conditionalHostedOwnershipBinding } from "@/lib/hosted-execution/conditional-ownership-binding";
import { assertWalletNetwork } from "./wallet-signature";
const PROOF_SECONDS = 180;
/** Sequence zero is a sign-only ownership proof, never a payment or sender. */
export function conditionalHostedOwnershipTransaction(
  payer: string,
  bindingDigest: string,
  networkPassphrase: string,
  minTime: number,
) {
  if (
    !/^[a-f0-9]{64}$/.test(bindingDigest) ||
    !Number.isSafeInteger(minTime) ||
    minTime < 0 ||
    !Number.isSafeInteger(minTime + PROOF_SECONDS)
  )
    throw new Error("Invalid conditional wallet ownership challenge");
  return new TransactionBuilder(new Account(payer, "-1"), {
    fee: "100",
    networkPassphrase,
    timebounds: { minTime, maxTime: minTime + PROOF_SECONDS },
  })
    .addOperation(
      Operation.manageData({ name: "paiflow.hosted-ownership.v2", value: bindingDigest }),
    )
    .build();
}
export async function assertConditionalHostedOwnershipChallenge(
  raw: ConditionalHostedOwnershipChallenge,
  deploymentId: string,
  input: ConditionalHostedOwnershipRequest,
  network: "testnet" | "mainnet",
) {
  const challenge = ConditionalHostedOwnershipChallengeSchema.parse(raw);
  if (challenge.network !== network) throw new Error("Ownership challenge network changed");
  assertWalletNetwork(network, challenge.networkPassphrase);
  const expectedDigest = await conditionalHostedOwnershipBinding(
    deploymentId,
    input,
    network,
    challenge.networkPassphrase,
  );
  if (challenge.bindingDigest !== expectedDigest)
    throw new Error("Ownership challenge differs from the original request and capability");
  const tx = TransactionBuilder.fromXDR(challenge.xdr, challenge.networkPassphrase);
  if (
    !(tx instanceof Transaction) ||
    tx.toEnvelope().switch().name !== "envelopeTypeTx" ||
    tx.signatures.length ||
    !tx.timeBounds
  )
    throw new Error("Invalid conditional ownership challenge");
  const min = Number(tx.timeBounds.minTime),
    max = Number(tx.timeBounds.maxTime),
    now = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(min) ||
    !Number.isSafeInteger(max) ||
    min > now ||
    max <= now ||
    max > now + PROOF_SECONDS
  )
    throw new Error("Conditional ownership challenge is outside its validity window");
  const expected = conditionalHostedOwnershipTransaction(
    input.payment.from,
    expectedDigest,
    challenge.networkPassphrase,
    min,
  );
  if (!tx.hash().equals(expected.hash()))
    throw new Error("Conditional ownership challenge body differs from the sign-only proof");
}
