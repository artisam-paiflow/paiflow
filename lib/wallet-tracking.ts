"use client";

import type { WalletSurface } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/client";

export async function trackWalletConnection({
  surface,
  ...opts
}: {
  address: string;
  network: "testnet" | "mainnet";
  walletId: string;
  surface: WalletSurface;
}) {
  // The address goes to our own audit log only, never to analytics.
  track("wallet_connect_succeeded", { surface, wallet_id: opts.walletId });
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
