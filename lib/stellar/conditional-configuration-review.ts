import { Address, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  ConditionalMutationPreparedSchema,
  type ConditionalMutationPrepared,
} from "@/lib/mutations/conditional-schema";
import { mutationV2Args } from "./conditional-v2-codec";
import { preparedWalletTransactionHash } from "./wallet-signature";
/** Browser-safe inspection of the actual original envelope before review/signing.
 * Pure codecs do not confer artifact trust or replace authoritative server reads. */
export function assertConditionalConfigurationEnvelope(raw: ConditionalMutationPrepared) {
  const p = ConditionalMutationPreparedSchema.parse(raw);
  const tx = TransactionBuilder.fromXDR(p.xdr, p.networkPassphrase);
  if (
    !(tx instanceof Transaction) ||
    preparedWalletTransactionHash(p.network, p.xdr, p.walletAddress, p.networkPassphrase) !==
      p.txHash ||
    tx.signatures.length !== 0 ||
    tx.operations.length !== 1 ||
    !tx.timeBounds ||
    BigInt(tx.timeBounds.maxTime) <= 0n ||
    new Date(Number(tx.timeBounds.maxTime) * 1000).toISOString() !== p.expiresAt ||
    tx.fee !== p.feeStroops
  )
    throw new Error(
      "Original conditional envelope differs from the reviewed hash, source, fee or expiry.",
    );
  const op = tx.operations[0]!;
  if (
    op.type !== "invokeHostFunction" ||
    (op.source && op.source !== p.walletAddress) ||
    op.func.switch().name !== "hostFunctionTypeInvokeContract" ||
    (op.auth ?? []).some(
      (entry) => entry.credentials().switch().name !== "sorobanCredentialsSourceAccount",
    )
  )
    throw new Error("Unsupported original conditional authorization or operation.");
  const call = op.func.invokeContract(),
    expected = mutationV2Args(p.mutation),
    args = call.args();
  if (
    Address.fromScAddress(call.contractAddress()).toString() !== p.mutation.rootContract ||
    call.functionName().toString() !== "mutate_v2" ||
    args.length !== expected.length ||
    expected.some((arg, i) => !arg.toXDR().equals(args[i]!.toXDR()))
  )
    throw new Error(
      "Original conditional body differs from the exact reviewed changes and complete graph bindings.",
    );
}
