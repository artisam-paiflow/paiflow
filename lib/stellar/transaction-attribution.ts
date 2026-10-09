import "server-only";
import { Address, TransactionBuilder, FeeBumpTransaction } from "@stellar/stellar-sdk";
import { stellarPassphrase } from "@/lib/env";

/** Only a verified direct invocation establishes outside-submission attribution.
 * Cross-contract calls and token transfers alone are deliberately unsupported. */
export function invokesPipeline(envelope: string, txHash: string, snapshot: unknown): boolean {
  try {
    const tx = TransactionBuilder.fromXDR(envelope, stellarPassphrase());
    if (tx.hash().toString("hex") !== txHash) return false;
    const inner = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;
    const addresses = new Set(
      Array.isArray(snapshot)
        ? snapshot.flatMap((node: unknown) =>
            typeof node === "object" &&
            node !== null &&
            "contractAddress" in node &&
            typeof node.contractAddress === "string"
              ? [node.contractAddress]
              : [],
          )
        : [],
    );
    return inner.operations.some((op) => {
      if (op.type !== "invokeHostFunction") return false;
      if (op.func.switch().name !== "hostFunctionTypeInvokeContract") return false;
      return addresses.has(
        Address.fromScAddress(op.func.invokeContract().contractAddress()).toString(),
      );
    });
  } catch {
    return false;
  }
}
