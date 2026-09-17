import {
  FeeBumpTransaction,
  Keypair,
  Transaction,
  TransactionBuilder,
  extractBaseAddress,
} from "@stellar/stellar-sdk";
import { isAccountId, type StellarAccountId } from "./strkey";

/**
 * Who signed a transaction envelope, as far as the envelope itself can say.
 *
 * Every user-signed transaction this app builds uses the signer's own account
 * as the transaction source (`lib/stellar/invoke.ts`, `lib/stellar/deploy.ts`),
 * so the source account is the wallet that signed. That is strong evidence,
 * not proof: the source is the fee and sequence account, and a multisig
 * account or a non-master signer breaks the identity. `signedBySource` says
 * whether a signature hint on the envelope matches the source key, which is
 * what a single-signature wallet always produces.
 *
 * Pure: the passphrase is a parameter, never read from `env()`, so this runs
 * under vitest without the env scrub in `tests/unit/setup.ts` getting in the
 * way. It never throws — a malformed envelope is a value, not an exception,
 * because the call sites run after `sendTransaction` may already have
 * succeeded and must not answer 500 for a confirmed transaction.
 */
export type SignerInfo =
  | {
      ok: true;
      /** Always the `G…` form, so it joins to every other address column. */
      signerAddress: StellarAccountId;
      /** Equal to `signerAddress` unless the envelope is a fee bump. */
      feeSourceAddress: StellarAccountId;
      isFeeBump: boolean;
      /** The `M…` address when the source was muxed, else null. */
      muxedSource: string | null;
      signatureCount: number;
      signedBySource: boolean;
      /** The hash the network knows the envelope by: the outer hash of a fee bump. */
      txHash: string;
    }
  | { ok: false; reason: "unparseable" | "unsupported_source" };

function baseAccount(address: string): StellarAccountId | null {
  try {
    const base = extractBaseAddress(address);
    return isAccountId(base) ? base : null;
  } catch {
    return null;
  }
}

export function signerFromTransaction(tx: Transaction | FeeBumpTransaction): SignerInfo {
  try {
    const isFeeBump = tx instanceof FeeBumpTransaction;
    const inner = isFeeBump ? tx.innerTransaction : tx;
    const rawSource = inner.source;
    const signerAddress = baseAccount(rawSource);
    const feeSourceAddress = isFeeBump ? baseAccount(tx.feeSource) : signerAddress;
    if (!signerAddress || !feeSourceAddress) {
      return { ok: false, reason: "unsupported_source" };
    }
    const hint = Keypair.fromPublicKey(signerAddress).signatureHint();
    const signatures = inner.signatures;
    return {
      ok: true,
      signerAddress,
      feeSourceAddress,
      isFeeBump,
      muxedSource: rawSource === signerAddress ? null : rawSource,
      signatureCount: signatures.length,
      signedBySource: signatures.some((s) => s.hint().equals(hint)),
      txHash: tx.hash().toString("hex"),
    };
  } catch {
    return { ok: false, reason: "unparseable" };
  }
}

export function signerFromSignedXdr(signedXdr: string, networkPassphrase: string): SignerInfo {
  let tx: Transaction | FeeBumpTransaction;
  try {
    tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  } catch {
    return { ok: false, reason: "unparseable" };
  }
  return signerFromTransaction(tx);
}
