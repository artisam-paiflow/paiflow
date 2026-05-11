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

const PASSPHRASE_BY_NETWORK = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
} as const;

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

export default function DeployReview({
  flowId,
  enableMainnet,
}: {
  flowId: string;
  enableMainnet: boolean;
}) {
  const [network, setNetwork] = useState<"testnet" | "mainnet">("testnet");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);

  async function onDeploy() {
    setBusy(true);
    try {
      const kit = await connectWallet(network);
      const { address } = await kit.getAddress();
      const prepBody: Record<string, unknown> = {
        flowId,
        network,
        sourceAccount: address,
      };
      if (network === "mainnet") prepBody.confirmation = confirmation;
      const prep = await fetch("/api/deployments/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(prepBody),
      });
      const prepData = await prep.json();
      if (!prep.ok) throw new Error(prepData?.error?.message ?? "Prepare failed");

      const signed = await kit.signTransaction(prepData.data.xdr, {
        address,
        networkPassphrase: PASSPHRASE_BY_NETWORK[network],
      });

      const submit = await fetch(`/api/deployments/${prepData.data.deploymentId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedXdr: signed.signedTxXdr }),
      });
      const subData = await submit.json();
      if (!submit.ok) throw new Error(subData?.error?.message ?? "Submit failed");
      toast.success("Contract deployed");
      window.location.href = `/deployments/${prepData.data.deploymentId}`;
    } catch (err) {
      toast.error((err as Error).message ?? "Deploy failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 space-y-4 rounded-xl border border-zinc-800 bg-zinc-950 p-5">
      <div className="grid gap-1 text-sm">
        <label className="text-zinc-400">Network</label>
        <div className="flex gap-2">
          <button
            onClick={() => setNetwork("testnet")}
            className={`rounded px-3 py-1 text-sm ${
              network === "testnet"
                ? "bg-brand-600 text-white"
                : "border border-zinc-700 text-zinc-300"
            }`}
          >
            Testnet
          </button>
          <button
            onClick={() => setNetwork("mainnet")}
            disabled={!enableMainnet}
            className={`rounded px-3 py-1 text-sm ${
              network === "mainnet"
                ? "bg-red-600 text-white"
                : "border border-zinc-700 text-zinc-300"
            } disabled:opacity-40`}
          >
            Mainnet{!enableMainnet && " (disabled)"}
          </button>
        </div>
      </div>
      {network === "mainnet" && (
        <label className="grid gap-1 text-sm">
          <span className="text-zinc-400">Type "I understand" to confirm mainnet:</span>
          <input
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            className="rounded border border-red-700 bg-zinc-900 px-3 py-2 font-mono"
            placeholder="I understand"
          />
        </label>
      )}
      <button
        onClick={onDeploy}
        disabled={busy || (network === "mainnet" && confirmation !== "I understand")}
        className="bg-brand-600 hover:bg-brand-500 w-full rounded-md px-4 py-2 font-semibold disabled:opacity-50"
      >
        {busy ? "Deploying…" : `Deploy to ${network}`}
      </button>
      <p className="text-xs text-zinc-500">
        You'll sign the transaction in your wallet (Freighter, Albedo, xBull, LOBSTR, Hana). Pink
        Raft never sees your secret key.
      </p>
    </section>
  );
}
