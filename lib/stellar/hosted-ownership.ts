import "server-only";
import { createHash } from "node:crypto";
import { Keypair, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { env, stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { executionRequestDigest } from "@/lib/api/v1/execution-intent";
import {
  HostedOwnershipRequestSchema,
  type HostedOwnershipRequest,
} from "@/lib/hosted-execution/schema";
import { HOSTED_PROOF_SECONDS, hostedOwnershipTransaction } from "./hosted-ownership-transaction";

function bindingDigest(deploymentId: string, input: HostedOwnershipRequest) {
  const parsed = HostedOwnershipRequestSchema.parse(input);
  return executionRequestDigest({
    domain: "paiflow.hosted-execution.ownership",
    version: 1,
    deploymentId,
    payer: parsed.payment.from,
    network: env().STELLAR_NETWORK,
    networkPassphraseHash: createHash("sha256").update(stellarPassphrase()).digest("hex"),
    requestDigest: executionRequestDigest(parsed.payment),
    recoveryKeyHash: createHash("sha256").update(parsed.recoveryKey).digest("hex"),
  });
}

/** Stateless: issuing a challenge does not reserve a payer or create financial work. */
export function createHostedOwnershipChallenge(
  deploymentId: string,
  input: HostedOwnershipRequest,
) {
  const digest = bindingDigest(deploymentId, input);
  return {
    xdr: hostedOwnershipTransaction(
      input.payment.from,
      digest,
      stellarPassphrase(),
      Math.floor(Date.now() / 1000),
    ).toXDR(),
    bindingDigest: digest,
    network: env().STELLAR_NETWORK,
    networkPassphrase: stellarPassphrase(),
  };
}

export function verifyHostedOwnershipProof(
  deploymentId: string,
  input: HostedOwnershipRequest,
  signedXdr?: string,
) {
  const invalid = () =>
    new AppError(
      "VALIDATION",
      "Verify ownership of the payer wallet before preparing this payment",
      { ownershipProofXdr: ["A current wallet ownership signature is required"] },
    );
  if (!signedXdr || signedXdr.length > 4096) throw invalid();
  try {
    const tx = TransactionBuilder.fromXDR(signedXdr, stellarPassphrase());
    if (
      !(tx instanceof Transaction) ||
      tx.toEnvelope().switch().name !== "envelopeTypeTx" ||
      !tx.timeBounds ||
      tx.signatures.length !== 1
    )
      throw invalid();
    const min = Number(tx.timeBounds.minTime);
    const max = Number(tx.timeBounds.maxTime);
    const now = Math.floor(Date.now() / 1000);
    if (
      !Number.isSafeInteger(min) ||
      !Number.isSafeInteger(max) ||
      min > now ||
      max <= now ||
      max > now + HOSTED_PROOF_SECONDS
    )
      throw invalid();
    const expected = hostedOwnershipTransaction(
      input.payment.from,
      bindingDigest(deploymentId, input),
      stellarPassphrase(),
      min,
    );
    const payerKey = Keypair.fromPublicKey(input.payment.from);
    if (
      !tx.hash().equals(expected.hash()) ||
      !payerKey.signatureHint().equals(tx.signatures[0]!.hint()) ||
      !payerKey.verify(tx.hash(), tx.signatures[0]!.signature())
    )
      throw invalid();
  } catch {
    // Never include envelope bytes or SDK diagnostics in an error/log.
    throw invalid();
  }
}
