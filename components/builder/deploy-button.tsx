"use client";

import { useState } from "react";
import { toast } from "sonner";

export default function DeployButton({ flowId }: { flowId: string }) {
  const [busy, setBusy] = useState(false);

  async function onDeploy() {
    setBusy(true);
    try {
      const kit = await connectWallet();
      const { address } = await kit.getAddress();
      const prep = await fetch("/api/deployments/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ flowId, network: "testnet", sourceAccount: address }),
      });
      const prepBody = await prep.json();
      if (!prep.ok) throw new Error(prepBody?.error?.message ?? "Prepare failed");
      const { deploymentId, xdr } = prepBody.data;

      const signed = await kit.signTransaction(xdr, {
        address,
        networkPassphrase: "Test SDF Network ; September 2015",
      });

      const submit = await fetch(`/api/deployments/${deploymentId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedXdr: signed.signedTxXdr }),
      });
      const submitBody = await submit.json();
      if (!submit.ok)
        throw new Error(submitBody?.error?.message ?? "Submit failed");
      toast.success("Contract deployed");
      window.location.href = `/deployments/${deploymentId}`;
    } catch (err) {
      toast.error((err as Error).message ?? "Deploy failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onDeploy}
      disabled={busy}
      className="rounded bg-brand-600 px-4 py-1.5 text-sm font-semibold hover:bg-brand-500 disabled:opacity-60"
    >
      {busy ? "Deploying…" : "Deploy"}
    </button>
  );
}

type WalletKit = {
  getAddress: () => Promise<{ address: string }>;
  signTransaction: (
    xdr: string,
    opts: { address: string; networkPassphrase: string },
  ) => Promise<{ signedTxXdr: string }>;
};

async function connectWallet(): Promise<WalletKit> {
  const mod = await import("@creit.tech/stellar-wallets-kit");
  const {
    StellarWalletsKit,
    WalletNetwork,
    allowAllModules,
    FREIGHTER_ID,
  } = mod as unknown as {
    StellarWalletsKit: new (opts: {
      network: string;
      selectedWalletId: string;
      modules: unknown[];
    }) => WalletKit & { openModal: (opts: { onWalletSelected: (o: { id: string }) => void }) => Promise<void> };
    WalletNetwork: { TESTNET: string };
    allowAllModules: () => unknown[];
    FREIGHTER_ID: string;
  };
  const kit = new StellarWalletsKit({
    network: WalletNetwork.TESTNET,
    selectedWalletId: FREIGHTER_ID,
    modules: allowAllModules(),
  });
  return kit;
}
