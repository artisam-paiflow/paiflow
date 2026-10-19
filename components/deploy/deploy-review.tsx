"use client";

import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import type { TemplateKind } from "@prisma/client";
import type { Asset } from "@/lib/flows/schema";
import type { TrustlineCheck } from "@/lib/stellar/trustline-check";
import { toastError } from "@/lib/friendly-toast";
import { implementationLabel } from "@/lib/flows/implementation";
import { TEMPLATE_LABELS } from "@/lib/flows/template-labels";
import { apiError } from "@/lib/friendly-error";
import { trackWalletConnection } from "@/lib/wallet-tracking";
import { track } from "@/lib/analytics/client";
import { classifyError } from "@/lib/analytics/classify-error";
import SwapQuotePreview from "@/components/builder/swap-quote-preview";
import TrustlineWarnings from "@/components/deploy/trustline-warnings";

type WalletKit = {
  getAddress: () => Promise<{ address: string }>;
  signTransaction: (
    xdr: string,
    opts: { address?: string; networkPassphrase: string },
  ) => Promise<{ signedTxXdr: string }>;
};

type StellarNetwork = "testnet" | "mainnet";

const CHECK_WAIT_CAP_MS = 15_000;

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
  swapPreviews,
  trustlineCheck,
}: {
  flowId: string;
  network: StellarNetwork;
  /** One entry per swap node in the flow: drives the live Soroswap previews. */
  swapPreviews?: Array<{ id: string; assetIn: Asset; assetOut: Asset; slippageBps: number }>;
  /** Streamed from the server: payout recipients' trustlines, looked up on Horizon. */
  trustlineCheck?: Promise<TrustlineCheck[]>;
}) {
  const [busy, setBusy] = useState(false);
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const [recoveryLoaded, setRecoveryLoaded] = useState(false);
  const [recoveryTerminal, setRecoveryTerminal] = useState<"CONFIRMED" | "FAILED" | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [retrySubmission, setRetrySubmission] = useState<{
    deploymentId: string;
    signedXdr: string;
  } | null>(null);
  const recoveryKey = `paiflow-deploy-recovery:${network}:${flowId}`;
  useEffect(() => {
    let active = true;
    setRecoveryLoaded(false);
    setRecoveryTerminal(null);
    setRetrySubmission(null);
    setSubmitError(null);
    setRecoveryId(null);
    try {
      const savedId = sessionStorage.getItem(recoveryKey);
      setRecoveryId(savedId);
      if (savedId) {
        // Offer an explicit new deployment only after the previous one has a known
        // terminal status. Missing reads leave the original deployment guarded.
        void fetch(`/api/deployments/${encodeURIComponent(savedId)}/status`)
          .then(async (response) => {
            if (!response.ok) return;
            const body = await response.json();
            if (active && (body.status === "CONFIRMED" || body.status === "FAILED")) {
              setRecoveryTerminal(body.status);
            }
          })
          .catch(() => {});
      }
    } catch {
      // The in-memory guard still protects this review if browser storage is unavailable.
    }
    setRecoveryLoaded(true);
    return () => {
      active = false;
    };
  }, [recoveryKey]);
  const [pipeline, setPipeline] = useState<
    Array<{
      nodeId: string;
      contractAddress: string;
      templateKind: TemplateKind;
      implementation?: unknown;
    }>
  >([]);
  const isMainnet = network === "mainnet";
  const swapCount = swapPreviews?.length ?? 0;

  useEffect(() => {
    track("deploy_review_viewed", { flow_id: flowId, swap_count: swapCount });
  }, [flowId, swapCount]);

  // #574 asks for the warning before the user signs, so Deploy waits for the
  // trustline check. It never rejects and Horizon times out at 10s; the cap
  // only stops a stalled stream from locking Deploy for good.
  const [checkSettled, setCheckSettled] = useState(!trustlineCheck);
  useEffect(() => {
    if (!trustlineCheck) {
      setCheckSettled(true);
      return;
    }
    let live = true;
    setCheckSettled(false);
    const settle = () => {
      if (live) setCheckSettled(true);
    };
    const cap = setTimeout(settle, CHECK_WAIT_CAP_MS);
    trustlineCheck.then(settle, settle);
    return () => {
      live = false;
      clearTimeout(cap);
    };
  }, [trustlineCheck]);

  async function onDeploy() {
    if (!checkSettled || !recoveryLoaded || (recoveryId && !retrySubmission) || busy) return;
    setBusy(true);
    track("deploy_started", { flow_id: flowId });
    let stage: "wallet" | "prepare" | "sign" | "submit" = "wallet";
    let deploymentId: string | undefined;
    let signedXdr: string;
    try {
      if (retrySubmission) {
        deploymentId = retrySubmission.deploymentId;
        signedXdr = retrySubmission.signedXdr;
      } else {
        const kit = await connectWallet(network);
        const { address } = await kit.getAddress();
        void trackWalletConnection({
          address,
          network,
          walletId: "freighter",
          surface: "deploy_review",
        });
        stage = "prepare";
        const prep = await fetch("/api/deployments/prepare", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ flowId, sourceAccount: address }),
        });
        const prepData = await prep.json();
        if (!prep.ok) throw apiError(prepData, "Prepare failed");
        setPipeline(prepData.data.pipeline ?? []);
        deploymentId = prepData.data.deploymentId;

        stage = "sign";
        const signed = await kit.signTransaction(prepData.data.xdr, {
          address,
          networkPassphrase: PASSPHRASE_BY_NETWORK[network],
        });

        signedXdr = signed.signedTxXdr;
      }
      stage = "submit";
      setRetrySubmission(null);
      setSubmitError(null);
      // Persist only the deployment identity, before attempting the send. A lost response
      // (or a reload) must lead back to this deployment, never a fresh preparation.
      setRecoveryId(deploymentId!);
      try {
        sessionStorage.setItem(recoveryKey, deploymentId!);
      } catch {
        // Keep the in-memory guard even when browser storage is unavailable.
      }
      const submit = await fetch(`/api/deployments/${deploymentId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedXdr }),
      });
      const subData = await submit.json();
      if (!submit.ok) {
        const error = apiError(subData, "Submit failed");
        setSubmitError(error.message);
        // Only a positive refusal permits retrying the exact same signed envelope.
        // Missing/failed acknowledgements remain guarded by the original identity.
        if (subData.error?.submissionStatus === "NOT_ACCEPTED") {
          setRetrySubmission({ deploymentId: deploymentId!, signedXdr });
        }
        throw error;
      }
      toast.success(
        subData.data.status === "CONFIRMED"
          ? "Contract deployed."
          : "Transaction submitted; waiting for confirmation.",
      );
      window.location.href = `/deployments/${deploymentId}`;
    } catch (err) {
      if (stage === "submit" && deploymentId) {
        toastError(err, "Submission status could not be checked.");
        toast.info(
          "Check the original deployment for its transaction status before deploying again.",
        );
        return;
      }
      // deploy_confirmed and the chain-side failure are captured server-side;
      // this is the part only the browser sees: wallet, signing, refusals.
      const c = classifyError(err);
      track("deploy_failed", {
        stage,
        error_class: c.errorClass,
        error_code: c.errorCode,
        flow_id: flowId,
        ...(deploymentId ? { deployment_id: deploymentId } : {}),
      });
      toastError(err, "Deploy failed");
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
        {swapPreviews?.map((s) => (
          <SwapQuotePreview
            key={s.id}
            assetIn={s.assetIn}
            assetOut={s.assetOut}
            slippageBps={s.slippageBps}
            compact
          />
        ))}
      </div>
      {trustlineCheck && (
        <Suspense
          fallback={
            <p role="status" className="text-on-surface-variant px-1 font-mono text-xs">
              Checking recipient trustlines…
            </p>
          }
        >
          <TrustlineWarnings check={trustlineCheck} network={network} context="deploy" />
        </Suspense>
      )}
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
                    {implementationLabel(node.implementation) ?? TEMPLATE_LABELS[node.templateKind]}
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
      {recoveryId && (
        <p role="status" className="text-label-sm text-on-surface-variant font-mono">
          {recoveryTerminal
            ? `The original deployment is ${recoveryTerminal.toLowerCase()}.`
            : "Check the original deployment for its transaction status."}{" "}
          <a
            className="text-primary underline"
            href={`/deployments/${encodeURIComponent(recoveryId)}`}
          >
            View deployment
          </a>
        </p>
      )}
      {submitError && (
        <p role="alert" className="text-label-sm text-error font-mono">
          {submitError}
        </p>
      )}
      {recoveryTerminal && (
        <button
          type="button"
          onClick={() => {
            try {
              sessionStorage.removeItem(recoveryKey);
            } catch {
              return;
            }
            setRecoveryId(null);
            setRecoveryTerminal(null);
            setSubmitError(null);
          }}
          className="text-primary underline"
        >
          Deploy another
        </button>
      )}
      <button
        onClick={onDeploy}
        disabled={
          busy || !checkSettled || !recoveryLoaded || (recoveryId !== null && !retrySubmission)
        }
        className="bg-primary px-md text-label-md text-on-primary inline-flex w-full items-center justify-center gap-2 rounded-lg py-3 font-mono font-bold transition-all duration-200 hover:-translate-y-px hover:shadow-[0_0_24px_rgba(255,177,196,0.55)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        {busy ? (
          <>
            <span className="material-symbols-outlined animate-spin text-[16px]">
              progress_activity
            </span>
            DEPLOYING…
          </>
        ) : retrySubmission ? (
          "RETRY SUBMISSION"
        ) : !checkSettled ? (
          <>
            <span className="material-symbols-outlined animate-spin text-[16px]">
              progress_activity
            </span>
            CHECKING RECIPIENTS…
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
        YOU’LL SIGN IN YOUR WALLET (FREIGHTER, ALBEDO, XBULL, LOBSTR, HANA). PAIFLOW NEVER SEES YOUR
        SECRET KEY.
      </p>
    </section>
  );
}
