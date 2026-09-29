import "server-only";
import { NotFoundError, StrKey } from "@stellar/stellar-sdk";
import type { PayoutRecipient } from "@/lib/flows/payout-recipients";
import { isPendingAddress } from "@/lib/flows/schema";
import { log } from "@/lib/log";
import { resolveAsset } from "./assets";
import { horizon } from "./client";

type Base = { nodeId: string; address: string; label?: string };
type AssetRef = { assetCode: string; assetIssuer: string };

/**
 * One payout recipient's readiness to receive the flow's asset.
 *
 * - `ok`: the account holds a trustline to the exact code and issuer.
 * - `not_needed`: native XLM, which needs no trustline.
 * - `skipped`: a `PENDING:` placeholder or a non-account address.
 * - `no_trustline`: the account exists but trusts no such asset from this
 *   issuer. `otherIssuers` lists issuers it trusts for the same code: a USDC
 *   trustline to the wrong issuer fails the payout just the same (#574).
 * - `no_account`: Horizon has no such account on this network.
 * - `unknown`: Horizon could not be asked; the caller shows "couldn't check".
 */
export type TrustlineCheck =
  | (Base & { status: "ok" } & AssetRef)
  | (Base & { status: "not_needed" | "skipped" })
  | (Base & { status: "no_trustline"; otherIssuers: string[] } & AssetRef)
  | (Base & { status: "no_account" } & AssetRef)
  | (Base & { status: "unknown" } & AssetRef);

type BalanceLine = { asset_type: string; asset_code?: string; asset_issuer?: string };
type AccountLookup = { kind: "found"; balances: BalanceLine[] } | { kind: "missing" | "error" };

async function lookupAccount(address: string): Promise<AccountLookup> {
  try {
    const acct = await horizon().loadAccount(address);
    return { kind: "found", balances: acct.balances as BalanceLine[] };
  } catch (err) {
    if (err instanceof NotFoundError) return { kind: "missing" };
    log.warn({ err, address }, "Horizon account lookup failed; trustline check degraded");
    return { kind: "error" };
  }
}

/**
 * Look every non-native payout recipient up on Horizon and report whether it
 * can receive the flow's asset from the issuer the flow actually pays out.
 * Never rejects: a lookup failure is reported as `unknown` for that recipient,
 * since this only feeds a warning and must not break the page showing it.
 */
export async function checkPayoutTrustlines(
  recipients: PayoutRecipient[],
): Promise<TrustlineCheck[]> {
  const lookups = new Map<string, Promise<AccountLookup>>();
  const lookup = (address: string) => {
    let p = lookups.get(address);
    if (!p) {
      p = lookupAccount(address);
      lookups.set(address, p);
    }
    return p;
  };

  return Promise.all(
    recipients.map(async (r): Promise<TrustlineCheck> => {
      const base: Base = {
        nodeId: r.nodeId,
        address: r.address,
        ...(r.label ? { label: r.label } : {}),
      };
      if (isPendingAddress(r.address) || !StrKey.isValidEd25519PublicKey(r.address)) {
        return { ...base, status: "skipped" };
      }
      if (r.asset.kind === "native") return { ...base, status: "not_needed" };

      let ref: AssetRef;
      try {
        const a = resolveAsset(r.asset);
        ref = { assetCode: a.getCode(), assetIssuer: a.getIssuer() };
      } catch (err) {
        log.warn({ err, asset: r.asset }, "Payout asset did not resolve; trustline check skipped");
        return { ...base, status: "skipped" };
      }

      const account = await lookup(r.address);
      if (account.kind !== "found") {
        return { ...base, status: account.kind === "missing" ? "no_account" : "unknown", ...ref };
      }

      const sameCode = account.balances.filter(
        (b) => b.asset_type.startsWith("credit_alphanum") && b.asset_code === ref.assetCode,
      );
      if (sameCode.some((b) => b.asset_issuer === ref.assetIssuer)) {
        return { ...base, status: "ok", ...ref };
      }
      const otherIssuers = sameCode.flatMap((b) => (b.asset_issuer ? [b.asset_issuer] : []));
      return { ...base, status: "no_trustline", otherIssuers, ...ref };
    }),
  );
}
