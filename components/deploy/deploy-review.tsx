"use client";

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { usePollTxStatus } from "@/lib/hooks/use-poll-tx-status";
import {
  DEPLOY_PENDING_EVENT,
  clearPendingDeploy,
  deployPendingKey,
  readPendingDeploy,
  savePendingDeploy,
  markPendingDeploySubmitted,
  rejectPendingDeploySigning,
  withDeployLock,
  type PendingDeploy,
} from "@/lib/deploy-pending";
import { signWithRecovery } from "@/lib/wallet-signing-recovery";
import SwapQuotePreview from "@/components/builder/swap-quote-preview";
import TrustlineWarnings from "@/components/deploy/trustline-warnings";
import { connectSelectedWallet, assertWalletAttemptActive } from "./selected-wallet-connection";

type StellarNetwork = "testnet" | "mainnet";

const CHECK_WAIT_CAP_MS = 15_000;

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
  const attemptRef = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    setBusy(false);
    return () => {
      attemptRef.current?.abort();
    };
  }, [flowId, network]);
  const pendingKey = deployPendingKey(flowId, network);
  const [pending, setPending] = useState<PendingDeploy | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const pollTxStatus = usePollTxStatus();
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

  function loadPending() {
    try {
      const saved = readPendingDeploy(pendingKey);
      setPending(saved);
      setStorageBlocked(false);
      return saved;
    } catch {
      setStorageBlocked(true);
      setStatusMessage(
        "Deployment status storage is unavailable or invalid. Resolve it before deploying again.",
      );
      throw new Error("Deployment status storage is unavailable or invalid.");
    } finally {
      setStorageReady(true);
    }
  }
  async function reconcile(saved: PendingDeploy, current: () => boolean, navigate = false) {
    try {
      const outcome = await pollTxStatus(saved.deploymentId, saved.txHash);
      if (outcome.status !== "SUCCESS" && outcome.status !== "FAILED")
        throw new Error("Deployment finality is unknown.");
      const response = await fetch(`/api/deployments/${saved.deploymentId}/status`);
      if (!response.ok) throw new Error("Deployment bookkeeping is unavailable.");
      const stored: { status?: string; txHash?: string } = await response.json();
      const expected = outcome.status === "SUCCESS" ? "CONFIRMED" : "FAILED";
      if (stored.status !== expected || stored.txHash !== saved.txHash)
        throw new Error("Deployment bookkeeping is not reconciled.");
      clearPendingDeploy(pendingKey, saved);
      if (!current()) return;
      if (outcome.status === "SUCCESS") {
        setStatusMessage(`Deployment confirmed: ${saved.deploymentId}`);
        toast.success("Contract deployed.");
        if (navigate) window.location.href = `/deployments/${saved.deploymentId}`;
      } else {
        setStatusMessage(`Deployment failed on the network: ${saved.txHash}. You can try again.`);
        toastError(
          new Error(outcome.errorMessage ?? "Deployment failed on the network"),
          "Deploy failed",
        );
      }
    } catch {
      if (current())
        setStatusMessage(
          saved.phase === "signing"
            ? `Signing outcome is still unknown for ${saved.txHash}. No submission is recorded. Check this deployment before deploying again.`
            : `Confirmation is still unknown for ${saved.txHash}. Check this deployment before deploying again.`,
        );
    }
  }
  async function checkPendingStatus(saved: PendingDeploy) {
    if (attemptRef.current && !attemptRef.current.signal.aborted) return;
    const controller = new AbortController();
    attemptRef.current = controller;
    const current = () => attemptRef.current === controller && !controller.signal.aborted;
    setBusy(true);
    try {
      await withDeployLock(pendingKey, async () => {
        const actual = readPendingDeploy(pendingKey);
        if (actual?.deploymentId === saved.deploymentId && actual.txHash === saved.txHash)
          await reconcile(actual, current);
      });
    } catch {
      if (current())
        setStatusMessage(
          "Another tab may be checking this deployment. Its status remains unresolved.",
        );
    } finally {
      if (attemptRef.current === controller) {
        attemptRef.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }
  useEffect(() => {
    setStorageReady(false);
    setStatusMessage(null);
    const refresh = () => {
      try {
        loadPending();
      } catch {
        /* Fail closed. */
      }
    };
    window.addEventListener("storage", refresh);
    window.addEventListener(DEPLOY_PENDING_EVENT, refresh);
    try {
      const saved = loadPending();
      if (saved) void checkPendingStatus(saved);
    } catch {
      /* No new write without recovery state. */
    }
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(DEPLOY_PENDING_EVENT, refresh);
    };
    // Recovery reads the captured deployment/hash and never repeats prepare or submit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey]);

  async function onDeploy() {
    if (
      !checkSettled ||
      !storageReady ||
      storageBlocked ||
      pending ||
      (attemptRef.current && !attemptRef.current.signal.aborted)
    )
      return;
    const controller = new AbortController();
    attemptRef.current = controller;
    const { signal } = controller;
    const check = () => assertWalletAttemptActive(signal);
    const current = () => attemptRef.current === controller && !signal.aborted;
    setBusy(true);
    track("deploy_started", { flow_id: flowId });
    let stage: "wallet" | "prepare" | "sign" | "submit" = "wallet";
    let deploymentId: string | undefined;
    try {
      await withDeployLock(pendingKey, async () => {
        let dispatched = false;
        let onAbort!: () => void;
        const cancelled = new Promise<never>((_resolve, reject) => {
          onAbort = () => {
            if (!dispatched) reject(new Error("Deployment cancelled before submission."));
          };
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) onAbort();
        });
        const execute = async () => {
          check();
          const existing = loadPending();
          if (existing) {
            dispatched = true;
            await reconcile(existing, current);
            return;
          }
          const { getWalletKit } = await import("@/components/deploy/wallet-kit");
          check();
          const shared = await getWalletKit(network);
          check();
          const connection = await connectSelectedWallet(shared, network, signal);
          check();
          if (!connection) return;
          const { address, walletId } = connection;
          void trackWalletConnection({ address, network, walletId, surface: "deploy_review" });
          stage = "prepare";
          const prep = await fetch("/api/deployments/prepare", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ flowId, sourceAccount: address }),
          });
          check();
          const prepData = await prep.json();
          check();
          if (!prep.ok) throw apiError(prepData, "Prepare failed");
          setPipeline(prepData.data.pipeline ?? []);
          deploymentId = prepData.data.deploymentId;
          if (
            typeof deploymentId !== "string" ||
            typeof prepData.data.xdr !== "string" ||
            typeof prepData.data.networkPassphrase !== "string" ||
            !prepData.data.networkPassphrase
          )
            throw new Error("Missing deployment transaction payload");
          const preparedDeploymentId = deploymentId;
          stage = "sign";
          const signed = await signWithRecovery({
            network,
            xdr: prepData.data.xdr,
            address,
            networkPassphrase: prepData.data.networkPassphrase,
            check,
            save: (attempt) => {
              try {
                savePendingDeploy(pendingKey, { ...attempt, deploymentId: preparedDeploymentId });
              } catch (error) {
                setStorageBlocked(true);
                setStatusMessage(
                  "Deployment status could not be saved. No signature was requested.",
                );
                throw error;
              }
            },
            read: () => readPendingDeploy(pendingKey),
            clearRejected: (attempt) => rejectPendingDeploySigning(pendingKey, attempt),
            sign: () =>
              connection.signTransaction(prepData.data.xdr, {
                address,
                networkPassphrase: prepData.data.networkPassphrase,
              }),
          });
          check();
          const saved = { ...signed.attempt, deploymentId, phase: "submitted" as const };
          markPendingDeploySubmitted(pendingKey, signed.attempt);
          check();
          dispatched = true;
          stage = "submit";
          try {
            void fetch(`/api/deployments/${deploymentId}/submit`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ signedXdr: signed.signedTxXdr }),
            }).catch(() => {});
          } catch {
            /* Preserve the recorded hash even if the response is lost. */
          }
          await reconcile(saved, current, true);
        };
        try {
          await Promise.race([execute(), cancelled]);
        } finally {
          signal.removeEventListener("abort", onAbort);
        }
      });
    } catch (err) {
      if (signal.aborted) return;
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
      if (attemptRef.current === controller) {
        attemptRef.current = null;
        if (!signal.aborted) setBusy(false);
      }
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
      <button
        onClick={onDeploy}
        disabled={busy || !checkSettled || !storageReady || storageBlocked || Boolean(pending)}
        className="bg-primary px-md text-label-md text-on-primary inline-flex w-full items-center justify-center gap-2 rounded-lg py-3 font-mono font-bold transition-all duration-200 hover:-translate-y-px hover:shadow-[0_0_24px_rgba(255,177,196,0.55)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        {busy ? (
          <>
            <span className="material-symbols-outlined animate-spin text-[16px]">
              progress_activity
            </span>
            DEPLOYING…
          </>
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
      {(pending || statusMessage) && (
        <div role="status" className="text-on-surface-variant space-y-2 text-xs">
          <p>
            {statusMessage ??
              (pending?.phase === "signing"
                ? `Signing outcome is unknown for ${pending.txHash}. No submission is recorded. Check this deployment before deploying again.`
                : `Deployment ${pending?.deploymentId} is awaiting confirmation. Check it before deploying again.`)}
          </p>
          {pending && (
            <>
              <a className="text-secondary underline" href={`/deployments/${pending.deploymentId}`}>
                VIEW DEPLOYMENT
              </a>
              <button
                type="button"
                disabled={busy}
                onClick={() => void checkPendingStatus(pending)}
                className="text-secondary ml-3 underline disabled:opacity-50"
              >
                CHECK DEPLOYMENT STATUS
              </button>
            </>
          )}
        </div>
      )}
      <p className="text-label-sm text-on-surface-variant flex items-start gap-1.5 font-mono">
        <span className="material-symbols-outlined text-secondary mt-0.5 text-[14px]">
          shield_lock
        </span>
        YOU’LL CHOOSE YOUR WALLET AND SIGN THERE. PAIFLOW NEVER SEES YOUR SECRET KEY.
      </p>
    </section>
  );
}
