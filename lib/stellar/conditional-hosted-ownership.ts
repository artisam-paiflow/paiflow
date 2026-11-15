import "server-only";
import { createHash } from "node:crypto";
import { Keypair, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { env, stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  ConditionalHostedOwnershipRequestSchema,
  ConditionalHostedOwnershipChallengeSchema,
  type ConditionalHostedOwnershipRequest,
} from "@/lib/hosted-execution/conditional-schema";
import {
  canonicalHostedValue,
  conditionalHostedOwnershipContext,
} from "@/lib/hosted-execution/conditional-ownership-binding";
import { conditionalHostedOwnershipTransaction } from "./conditional-ownership-transaction";
const proofSeconds = 180;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export function conditionalHostedOwnershipDigest(
  deploymentId: string,
  raw: ConditionalHostedOwnershipRequest,
) {
  const input = ConditionalHostedOwnershipRequestSchema.parse(raw);
  return sha256(
    canonicalHostedValue(
      conditionalHostedOwnershipContext({
        domain: "paiflow.hosted-execution.ownership",
        version: 2,
        deploymentId,
        payer: input.payment.from,
        network: env().STELLAR_NETWORK,
        networkPassphraseHash: sha256(stellarPassphrase()),
        requestDigest: sha256(canonicalHostedValue(input.payment)),
        recoveryKeyHash: sha256(input.recoveryKey),
      }),
    ),
  );
}
export function createConditionalHostedOwnershipChallenge(
  deploymentId: string,
  raw: ConditionalHostedOwnershipRequest,
) {
  const input = ConditionalHostedOwnershipRequestSchema.parse(raw),
    bindingDigest = conditionalHostedOwnershipDigest(deploymentId, input);
  return ConditionalHostedOwnershipChallengeSchema.parse({
    version: 2,
    xdr: conditionalHostedOwnershipTransaction(
      input.payment.from,
      bindingDigest,
      stellarPassphrase(),
      Math.floor(Date.now() / 1000),
    ).toXDR(),
    bindingDigest,
    network: env().STELLAR_NETWORK,
    networkPassphrase: stellarPassphrase(),
  });
}
/** Fixed-field ownership requirement is the only public v2 field exception. */
export function conditionalHostedOwnershipRequired() {
  return new AppError(
    "VALIDATION",
    "Verify ownership of the payer wallet before preparing this payment",
    { ownershipProofXdr: ["A current wallet ownership signature is required"] },
  );
}
export function verifyConditionalHostedOwnershipProof(
  deploymentId: string,
  raw: ConditionalHostedOwnershipRequest,
  signedXdr?: string,
) {
  if (!signedXdr || signedXdr.length > 4096) throw conditionalHostedOwnershipRequired();
  try {
    const input = ConditionalHostedOwnershipRequestSchema.parse(raw),
      tx = TransactionBuilder.fromXDR(signedXdr, stellarPassphrase());
    if (
      !(tx instanceof Transaction) ||
      tx.toEnvelope().switch().name !== "envelopeTypeTx" ||
      !tx.timeBounds ||
      tx.signatures.length !== 1
    )
      throw new Error();
    const min = Number(tx.timeBounds.minTime),
      max = Number(tx.timeBounds.maxTime),
      now = Math.floor(Date.now() / 1000);
    if (
      !Number.isSafeInteger(min) ||
      !Number.isSafeInteger(max) ||
      min > now ||
      max <= now ||
      max > now + proofSeconds
    )
      throw new Error();
    const expected = conditionalHostedOwnershipTransaction(
        input.payment.from,
        conditionalHostedOwnershipDigest(deploymentId, input),
        stellarPassphrase(),
        min,
      ),
      payer = Keypair.fromPublicKey(input.payment.from);
    if (
      !tx.hash().equals(expected.hash()) ||
      !payer.signatureHint().equals(tx.signatures[0]!.hint()) ||
      !payer.verify(tx.hash(), tx.signatures[0]!.signature())
    )
      throw new Error();
  } catch {
    throw conditionalHostedOwnershipRequired();
  }
}
