"use client";

import { useState } from "react";
import { toast } from "sonner";
import { TEMPLATE_LABELS } from "@/lib/flows/template-labels";
import type { TemplateKind } from "@prisma/client";

type WalletKit = {
  getAddress: () => Promise<{ address: string }>;
  signTransaction: (
    xdr: string,
    opts: { address?: string; networkPassphrase: string },
  ) => Promise<{ signedTxXdr: string }>;
};

type StellarNetwork = "testnet" | "mainnet";

const PASSPHRASE_BY_NETWORK: Record<StellarNetwork, string> = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
};

async function connectWallet(network: StellarNetwork): Promise<WalletKit> {
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
  network,
}: {
  flowId: string;
  network: StellarNetwork;
}) {
  const [busy, setBusy] = useState(false);
  const [pipeline, setPipeline] = useState<
    Array<{ nodeId: string; contractAddress: string; templateKind: TemplateKind }>
  >([]);
  const isMainnet = network === "mainnet";

  async function onDeploy() {
    setBusy(true);
    try {
      const kit = await connectWallet(network);
      const { address } = await kit.getAddress();
      const prep = await fetch("/api/deployments/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ flowId, sourceAccount: address }),
      });
      const prepData = await prep.json();
      if (!prep.ok) throw new Error(prepData?.error?.message ?? "Prepare failed");
      setPipeline(prepData.data.pipeline ?? []);

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

  const chipClass = isMainnet
    ? "border-error/40 bg-error-container/30 text-error"
    : "border-secondary/30 bg-secondary/10 text-secondary";

  return (
    <section className="glass-panel mt-md space-y-md p-md rounded-xl">
      <div className="grid gap-2">
        <span className="text-label-sm text-on-surface-variant font-mono uppercase">Network</span>
        <div className="flex items-center gap-2">
          <span
            className={`text-label-md inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono ${chipClass}`}
            aria-label={`Deploying to ${network}`}
            data-testid="network-chip"
          >
            <span className="status-dot-deploy h-1.5 w-1.5" />
            {network.toUpperCase()}
          </span>
          <span className="text-label-sm text-on-surface-variant font-mono">
            PINNED BY ENVIRONMENT
          </span>
        </div>
      </div>
      {pipeline.length > 0 && (
        <div className="grid gap-2">
          <span className="text-label-sm text-on-surface-variant font-mono uppercase">
            Pipeline
          </span>
          <ul className="space-y-2">
            {pipeline.map((node, i) => (
              <li key={node.nodeId} className="flex items-start gap-2">
                <span className="text-label-sm text-on-surface-variant mt-0.5 font-mono">
                  {i + 1}.
                </span>
                <div className="min-w-0">
                  <span className="text-label-md text-on-surface font-mono">
                    {TEMPLATE_LABELS[node.templateKind]}
                  </span>
                  <div className="text-label-sm text-on-surface-variant truncate font-mono">
                    {node.contractAddress}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        onClick={onDeploy}
        disabled={busy}
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
