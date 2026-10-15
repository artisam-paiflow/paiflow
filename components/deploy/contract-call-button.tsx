"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-toast";
import { usePollTxStatus } from "@/lib/hooks/use-poll-tx-status";
import { trackWalletConnection } from "@/lib/wallet-tracking";
import {
  CONTRACT_CALL_PENDING_EVENT,
  clearPendingContractCall,
  contractCallPendingKey,
  readPendingContractCall,
  savePendingContractCall,
  withContractCallLock,
  type PendingContractCall,
} from "@/lib/contract-call-pending";
import { getWalletKit } from "./wallet-kit";
import { assertWalletAttemptActive, connectSelectedWallet } from "./selected-wallet-connection";

type ContractCallButtonProps = {
  deploymentId: string;
  network: "testnet" | "mainnet";
  /** Stable operation identity, including any arguments that change what is signed. */
  actionKey: string;
  label: string;
  busyLabel: string;
  icon?: string;
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  prepare: (address: string) => Promise<{ xdr: string; networkPassphrase: string }>;
  submit: (signedXdr: string) => Promise<{ txHash: string }>;
  onSuccess?: () => void;
};

export default function ContractCallButton({
  deploymentId,
  network,
  actionKey,
  label,
  busyLabel,
  icon = "send",
  variant = "primary",
  size = "md",
  disabled = false,
  className = "",
  prepare,
  submit,
  onSuccess,
}: ContractCallButtonProps) {
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const pendingKey = contractCallPendingKey(deploymentId, network);
  const [pending, setPending] = useState<PendingContractCall | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  // Inline callbacks are recreated by polling parents. Only a changed signing
  // intent cancels preparation. Dispatch/reconciliation outlives the view.
  useLayoutEffect(() => {
    setBusy(false);
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [deploymentId, network, actionKey, disabled]);
  const pollTxStatus = usePollTxStatus();

  function loadPending() {
    try {
      const saved = readPendingContractCall(pendingKey);
      setPending(saved);
      setStorageBlocked(false);
      return saved;
    } catch {
      setStorageBlocked(true);
      setStatusMessage(
        "Transaction status storage is unavailable or invalid. Resolve it before starting another action.",
      );
      throw new Error("Transaction status storage is unavailable or invalid.");
    } finally {
      setStorageReady(true);
    }
  }

  async function reconcile(
    saved: PendingContractCall,
    isCurrentView: () => boolean,
    onConfirmed?: () => void,
  ) {
    try {
      // This controller deliberately belongs to no view. A changed action or
      // unmount must not discard an irreversible dispatch's hash or outcome.
      const outcome = await pollTxStatus(deploymentId, saved.txHash);
      if (outcome.status !== "SUCCESS" && outcome.status !== "FAILED") {
        throw new Error("Transaction finality is unknown.");
      }
      clearPendingContractCall(pendingKey, saved.txHash);
      if (!isCurrentView()) return;
      setStatusMessage(null);
      if (outcome.status === "SUCCESS") {
        toast.success("Transaction confirmed!");
        onConfirmed?.();
      } else {
        toastError(
          new Error(outcome.errorMessage ?? "Transaction failed on the network"),
          "Transaction failed",
        );
      }
    } catch {
      if (isCurrentView()) {
        setStatusMessage(
          `Confirmation is still unknown for ${saved.txHash}. Check its status before starting another action.`,
        );
      }
    }
  }

  async function checkPendingStatus(saved: PendingContractCall) {
    if (abortRef.current && !abortRef.current.signal.aborted) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const isCurrent = () => abortRef.current === controller && !controller.signal.aborted;
    setBusy(true);
    try {
      await withContractCallLock(pendingKey, async () => {
        const current = readPendingContractCall(pendingKey);
        if (current?.txHash === saved.txHash) await reconcile(current, isCurrent);
      });
    } catch {
      if (isCurrent()) {
        setStatusMessage(
          `Confirmation is still unknown for ${saved.txHash}. Check its status before starting another action.`,
        );
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
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
        // Reading and writing recovery state both fail closed.
      }
    };
    window.addEventListener("storage", refresh);
    window.addEventListener(CONTRACT_CALL_PENDING_EVENT, refresh);
    try {
      const saved = loadPending();
      if (saved) void checkPendingStatus(saved);
    } catch {
      // No signing or submission is permitted without reliable recovery state.
    }
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(CONTRACT_CALL_PENDING_EVENT, refresh);
    };
    // Recover only the hash when entering this deployment; never replay an action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey]);

  const variantClass =
    variant === "primary"
      ? "bg-primary text-on-primary hover:-translate-y-px hover:shadow-[0_0_24px_rgba(255,177,196,0.55)]"
      : variant === "danger"
        ? "bg-error text-on-error hover:-translate-y-px hover:shadow-[0_0_24px_rgba(239,68,68,0.4)]"
        : "border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20";

  const sizeClass =
    size === "sm" ? "text-label-sm px-3 py-1.5 gap-1.5" : "text-label-md px-4 py-2.5 gap-2";

  const handleClick = async () => {
    if (
      disabled ||
      !storageReady ||
      storageBlocked ||
      pending ||
      (abortRef.current && !abortRef.current.signal.aborted)
    )
      return;
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    const check = () => assertWalletAttemptActive(signal);
    const isCurrent = () => abortRef.current === controller && !signal.aborted;
    let connected = false;
    setBusy(true);

    try {
      await withContractCallLock(pendingKey, async () => {
        let admitted = false;
        let onAbort!: () => void;
        const cancelled = new Promise<never>((_resolve, reject) => {
          onAbort = () => {
            if (!admitted) reject(new Error("Transaction cancelled before submission."));
          };
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) onAbort();
        });
        const execute = async () => {
          check();
          const existing = loadPending();
          if (existing) {
            admitted = true;
            await reconcile(existing, isCurrent);
            return;
          }
          const shared = await getWalletKit(network);
          check();
          const connection = await connectSelectedWallet(shared, network, signal);
          check();
          if (!connection) {
            toast.warning("Connection cancelled");
            return;
          }
          const { address, walletId } = connection;
          connected = true;
          toast.success(`Connected: ${address.slice(0, 6)}...${address.slice(-4)}`);
          void trackWalletConnection({ address, network, walletId, surface: "contract_call" });

          toast.info("Preparing transaction...");
          const { xdr, networkPassphrase } = await prepare(address);
          check();

          toast.info("Awaiting signature...");
          const signed = await connection.signTransaction(xdr, { address, networkPassphrase });
          check();
          const { signedWalletTransactionHash } = await import("@/lib/stellar/wallet-signature");
          check();
          const txHash = signedWalletTransactionHash(
            network,
            xdr,
            signed.signedTxXdr,
            address,
            networkPassphrase,
          );
          const saved = { txHash };
          admitted = true;
          try {
            savePendingContractCall(pendingKey, saved);
          } catch (error) {
            if (isCurrent()) {
              setStorageBlocked(true);
              setStatusMessage(
                "Transaction status could not be saved. No transaction was submitted.",
              );
            }
            throw error;
          }
          // Irreversible boundary: from here, view cancellation only suppresses
          // stale UI. Never retry a write or discard its outcome on navigation.
          toast.info("Submitting transaction...");
          try {
            // Begin read-only reconciliation immediately: an HTTP response can
            // be delayed forever after the server has already sent the bytes.
            // Neither the response hash nor an error can replace this marker.
            void submit(signed.signedTxXdr).catch(() => {});
          } catch {
            // A callback/transport failure does not prove the bytes were not sent.
            // Reconcile the hash computed before dispatch, never a response hash.
          }
          if (isCurrent()) toast.info("Transaction submitted. Waiting for confirmation...");
          await reconcile(saved, isCurrent, onSuccess);
        };
        try {
          // Release an empty lock promptly when a wallet prompt is abandoned.
          // Every resumed preparation still checks its cancelled view signal.
          await Promise.race([execute(), cancelled]);
        } finally {
          signal.removeEventListener("abort", onAbort);
        }
      });
    } catch (err) {
      if (!signal.aborted) toastError(err, connected ? "Transaction failed" : "Connection failed");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        if (!signal.aborted) setBusy(false);
      }
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        disabled={busy || disabled || !storageReady || storageBlocked || Boolean(pending)}
        className={`${variantClass} ${sizeClass} ${className} inline-flex items-center justify-center rounded-lg font-mono font-bold transition-all duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none`}
      >
        {busy ? (
          <>
            <span className="material-symbols-outlined animate-spin text-[16px]">
              progress_activity
            </span>
            {busyLabel}
          </>
        ) : (
          <>
            <span className="material-symbols-outlined text-[16px]">{icon}</span>
            {label}
          </>
        )}
      </button>
      {(pending || storageBlocked) && (
        <div className="text-on-surface-variant space-y-2 text-xs" role="status">
          <p>
            {statusMessage ??
              `A transaction is awaiting confirmation: ${pending?.txHash}. Check its status before starting another action.`}
          </p>
          {pending && !storageBlocked && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void checkPendingStatus(pending)}
              className="text-secondary underline disabled:opacity-50"
            >
              CHECK TRANSACTION STATUS
            </button>
          )}
        </div>
      )}
    </>
  );
}
