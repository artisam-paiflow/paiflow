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
      toast.success("Contract deployed.");
      window.location.href = `/deployments/${prepData.data.deploymentId}`;
    } catch (err) {
      toast.error((err as Error).message ?? "Deploy failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="glass-panel mt-md space-y-md p-md rounded-xl">
      <div className="grid gap-2">
        <span className="text-label-sm text-on-surface-variant font-mono uppercase">Network</span>
        <div className="flex gap-2">
          <button
            onClick={() => setNetwork("testnet")}
            className={`text-label-md inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono transition-colors ${
              network === "testnet"
                ? "border-secondary bg-secondary/10 text-secondary"
                : "border-outline-variant/40 text-on-surface-variant hover:border-outline hover:text-on-surface"
            }`}
          >
            {network === "testnet" ? (
              <span className="status-dot-deploy h-1.5 w-1.5" />
            ) : (
              <span className="bg-outline-variant h-1.5 w-1.5 rounded-full" />
            )}
            TESTNET
          </button>
          <button
            onClick={() => setNetwork("mainnet")}
            disabled={!enableMainnet}
            className={`text-label-md inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              network === "mainnet"
                ? "border-error bg-error-container/30 text-error"
                : "border-outline-variant/40 text-on-surface-variant hover:border-outline hover:text-on-surface"
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">warning</span>
            MAINNET{!enableMainnet && " · DISABLED"}
          </button>
        </div>
      </div>
      {network === "mainnet" && (
        <label className="grid gap-1.5">
          <span className="text-label-sm text-error font-mono uppercase">
            Type “I understand” to confirm mainnet
          </span>
          <input
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            className="border-error/60 bg-surface-container-lowest text-on-surface focus:border-error focus:ring-error rounded border px-3 py-2 font-mono text-[14px] focus:ring-1 focus:outline-none"
            placeholder="I understand"
          />
        </label>
      )}
      <button
        onClick={onDeploy}
        disabled={busy || (network === "mainnet" && confirmation !== "I understand")}
        className="bg-primary px-md text-label-md text-on-primary inline-flex w-full items-center justify-center gap-2 rounded-lg py-3 font-mono font-bold transition-all duration-200 hover:-translate-y-px hover:shadow-[0_0_24px_rgba(255,177,196,0.55)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        {busy ? (
          <>
            <span className="material-symbols-outlined animate-spin text-[16px]">
              progress_activity
            </span>
            DEPLOYING…
          </>
        ) : (
          <>
            <span className="material-symbols-outlined text-[16px]">rocket_launch</span>
            DEPLOY TO {network.toUpperCase()}
          </>
        )}
      </button>
      <p className="text-label-sm text-on-surface-variant flex items-start gap-1.5 font-mono">
        <span className="material-symbols-outlined text-secondary mt-0.5 text-[14px]">
          shield_lock
        </span>
        YOU’LL SIGN IN YOUR WALLET (FREIGHTER, ALBEDO, XBULL, LOBSTR, HANA). PINK RAFT NEVER SEES
        YOUR SECRET KEY.
      </p>
    </section>
  );
}
