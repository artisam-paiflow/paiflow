import "server-only";
import type { PayoutRecipient } from "@/lib/flows/payout-recipients";
import type { Asset, FlowGraph } from "@/lib/flows/schema";
import { log } from "@/lib/log";
import { checkPayoutTrustlines } from "./trustline-check";

/**
 * A recipient that cannot receive the asset yet, as returned in
 * `data.warnings` by routes that set a recipient on-chain (dev-mode routes,
 * the payouts endpoint). Advisory only: the write still happens (#723).
 */
export type TrustlineWarning = {
  code: "MISSING_TRUSTLINE" | "MISSING_ACCOUNT";
  nodeId: string;
  recipient: string;
  asset: { code: string; issuer: string };
  /** Issuers the recipient trusts for the same code; a different asset. */
  otherIssuers?: string[];
  message: string;
};

/**
 * Trustline warnings for the given recipients. Never rejects: a failed lookup
 * (`unknown`) or any unexpected error yields no warning, since this must not
 * fail the mutation it accompanies.
 */
export async function trustlineWarnings(
  recipients: PayoutRecipient[],
): Promise<TrustlineWarning[]> {
  if (recipients.length === 0) return [];
  try {
    const checks = await checkPayoutTrustlines(recipients);
    const out: TrustlineWarning[] = [];
    for (const c of checks) {
      if (c.status === "no_trustline") {
        out.push({
          code: "MISSING_TRUSTLINE",
          nodeId: c.nodeId,
          recipient: c.address,
          asset: { code: c.assetCode, issuer: c.assetIssuer },
          ...(c.otherIssuers.length > 0 ? { otherIssuers: c.otherIssuers } : {}),
          message: `${c.address} has no ${c.assetCode} trustline from issuer ${c.assetIssuer}. Payouts to it will fail until it adds one.`,
        });
      } else if (c.status === "no_account") {
        out.push({
          code: "MISSING_ACCOUNT",
          nodeId: c.nodeId,
          recipient: c.address,
          asset: { code: c.assetCode, issuer: c.assetIssuer },
          message: `${c.address} does not exist on this network yet, so it cannot hold ${c.assetCode} from issuer ${c.assetIssuer}. Fund it and add the trustline before payouts.`,
        });
      }
    }
    return out;
  } catch (err) {
    log.warn({ err }, "Trustline warning check failed; returning no warnings");
    return [];
  }
}

/** The asset of a deployed graph node, or undefined if the snapshot lacks it. */
export function graphNodeAsset(
  graph: unknown,
  nodeId: string,
  type: "pay" | "split" | "subscription",
): Asset | undefined {
  const nodes = (graph as FlowGraph | null)?.nodes ?? [];
  const node = nodes.find((n) => n.id === nodeId && n.type === type);
  return (node?.config as { asset?: Asset } | undefined)?.asset;
}
