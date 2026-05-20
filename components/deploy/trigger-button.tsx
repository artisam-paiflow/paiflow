"use client";

import { useState } from "react";
import { toast } from "sonner";

type WalletKit = {
  getAddress: () => Promise<{ address: string }>;
  signTransaction: (
    xdr: string,
    opts: { address?: string; networkPassphrase: string },
  ) => Promise<{ signedTxXdr: string }>;
};

const PASSPHRASE_BY_NETWORK: Record<string, string> = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
};

function stellarNetworkPassphrase(network: string): string {
  return PASSPHRASE_BY_NETWORK[network] ?? "Test SDF Network ; September 2015";
}

async function connectWallet(network: "testnet" | "mainnet"): Promise<WalletKit> {
  const mod = await import("@creit.tech/stellar-wallets-kit");
  const { StellarWalletsKit, WalletNetwork, allowAllModules, FREIGHTER_ID } = mod as unknown as {
    StellarWalletsKit: new (opts: {
      network: string;
      selectedWalletId: string;
      modules: unknown[];
    }) => WalletKit;
    WalletNetwork: { TESTNET: string; PUBLIC: string };
    allowAllModules: () => unknown[];
    FREIGHTER_ID: string;
  };
  return new StellarWalletsKit({
    network: network === "mainnet" ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET,
    selectedWalletId: FREIGHTER_ID,
    modules: allowAllModules(),
  });
}

type TriggerButtonProps = {
  deploymentId: string;
  network: "testnet" | "mainnet";
  amount: string;
  onSuccess?: () => void;
};

export function TriggerButton({ deploymentId, network, amount, onSuccess }: TriggerButtonProps) {
  const [busy, setBusy] = useState(false);

  async function onTrigger() {
    if (!amount || !/^\d+$/.test(amount) || amount === "0") {
      toast.error("Enter a valid stroops amount");
      return;
    }
    setBusy(true);
    try {
      const kit = await connectWallet(network);
      const { address } = await kit.getAddress();

      const res = await fetch(`/api/deployments/${deploymentId}/trigger`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount, userAddress: address }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to prepare transaction");

      const signed = await kit.signTransaction(data.data.xdr, {
        address,
        networkPassphrase: stellarNetworkPassphrase(network),
      });

      const submit = await fetch(`/api/deployments/${deploymentId}/submit-trigger`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedXdr: signed.signedTxXdr }),
      });
      const subData = await submit.json();
      if (!submit.ok) throw new Error(subData?.error?.message ?? "Submit failed");
      toast.success("Distribution triggered!");
      onSuccess?.();
    } catch (err) {
      toast.error((err as Error).message ?? "Trigger failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onTrigger}
      disabled={busy}
      className="bg-primary px-md text-label-md text-on-primary inline-flex w-full items-center justify-center gap-2 rounded-lg py-3 font-mono font-bold transition-all duration-200 hover:-translate-y-px hover:shadow-[0_0_24px_rgba(255,177,196,0.55)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
    >
      {busy ? (
        <>
          <span className="material-symbols-outlined animate-spin text-[16px]">
            progress_activity
          </span>
          PROCESSING…
        </>
      ) : (
        <>
          <span className="material-symbols-outlined text-[16px]">send</span>
          CONNECT WALLET &amp; TRIGGER
        </>
      )}
    </button>
  );
}

export type { WalletKit };
