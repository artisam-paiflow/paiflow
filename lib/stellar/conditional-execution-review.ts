import { Address, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  ConditionalHostedPreparedSchema,
  type ConditionalHostedPrepared,
} from "@/lib/hosted-execution/conditional-schema";
import { executionV2Args } from "./conditional-v2-codec";
import { preparedWalletTransactionHash } from "./wallet-signature";
/** Inspect actual original bytes, not just JSON claims. Server live executable,
 * exact authorization/resource checks remain authoritative. No RPC/global Buffer. */
export function assertConditionalExecutionEnvelope(raw: ConditionalHostedPrepared) {
  const wrapper = ConditionalHostedPreparedSchema.parse(raw),
    p = wrapper.prepared,
    tx = TransactionBuilder.fromXDR(p.xdr, p.networkPassphrase);
  if (
    !(tx instanceof Transaction) ||
    preparedWalletTransactionHash(p.network, p.xdr, p.walletAddress, p.networkPassphrase) !==
      p.txHash ||
    tx.signatures.length !== 0 ||
    tx.operations.length !== 1 ||
    tx.memo.type !== "none" ||
    tx.toEnvelope().v1().tx().cond().switch().name !== "precondTime" ||
    !tx.timeBounds ||
    tx.timeBounds.minTime !== "0" ||
    BigInt(tx.timeBounds.maxTime) <= 0n ||
    new Date(Number(tx.timeBounds.maxTime) * 1000).toISOString() !== p.expiresAt ||
    tx.fee !== wrapper.feeStroops ||
    BigInt(wrapper.feeStroops) <= 0n
  )
    throw new Error(
      "Original conditional payment differs from its reviewed hash, source, fee or finite expiry",
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
    throw new Error("Unsupported original conditional payment operation or authorization");
  const call = op.func.invokeContract(),
    expected = executionV2Args(p.execution),
    args = call.args();
  if (
    Address.fromScAddress(call.contractAddress()).toString() !== p.execution.rootContract ||
    call.functionName().toString() !== "execute_v2" ||
    args.length !== 8 ||
    expected.some((arg, index) => !arg.toXDR().equals(args[index]!.toXDR()))
  )
    throw new Error(
      "Original conditional payment body differs from the complete reviewed route and bindings",
    );
}
