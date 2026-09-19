"use client";

import type { WalletSurface } from "@/lib/analytics/events";
import { setPersonProps, track } from "@/lib/analytics/client";

export async function trackWalletConnection({
  surface,
  ...opts
}: {
  address: string;
  network: "testnet" | "mainnet";
  walletId: string;
  surface: WalletSurface;
}) {
  // The public address is sent to analytics deliberately, so a transaction
  // can be traced to the wallet and account that signed it — see
  // docs/analytics/alpha-tracking-plan.md, "Wallet traceability". It travels
  // only on the allowlisted keys below; every other property still redacts it.
  track("wallet_connect_succeeded", {
    surface,
    wallet_id: opts.walletId,
    wallet_address: opts.address,
  });
  // Latest wallet, and the first one ever seen; a no-op when nobody is signed in.
  setPersonProps({ wallet_address: opts.address }, { wallet_address_first: opts.address });
  try {
    await fetch("/api/audit/wallet-connection", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts),
    });
  } catch {
    // Non-critical; never block the wallet flow.
  }
}
