"use client";

export async function trackWalletConnection(opts: {
  address: string;
  network: "testnet" | "mainnet";
  walletId: string;
}) {
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
