"use client";

import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-toast";
import { usePollTxStatus } from "@/lib/hooks/use-poll-tx-status";
import { trackWalletConnection } from "@/lib/wallet-tracking";
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
  // Inline callbacks are recreated by polling parents. Only a changed signing
  // intent ends an attempt; a render with equivalent callbacks must not do so.
  useEffect(() => {
    setBusy(false);
    return () => abortRef.current?.abort();
  }, [deploymentId, network, actionKey, disabled]);
  const pollTxStatus = usePollTxStatus();

  const variantClass =
    variant === "primary"
      ? "bg-primary text-on-primary hover:-translate-y-px hover:shadow-[0_0_24px_rgba(255,177,196,0.55)]"
      : variant === "danger"
        ? "bg-error text-on-error hover:-translate-y-px hover:shadow-[0_0_24px_rgba(239,68,68,0.4)]"
        : "border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20";

  const sizeClass =
    size === "sm" ? "text-label-sm px-3 py-1.5 gap-1.5" : "text-label-md px-4 py-2.5 gap-2";

  const handleClick = async () => {
    if (disabled || (abortRef.current && !abortRef.current.signal.aborted)) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    const check = () => assertWalletAttemptActive(signal);
    let connected = false;
    setBusy(true);

    try {
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
      const signed = await connection.signTransaction(xdr, {
        address,
        networkPassphrase,
      });
      check();

      toast.info("Submitting transaction...");
      const { txHash } = await submit(signed.signedTxXdr);
      check();

      toast.info("Transaction submitted. Waiting for confirmation...");
      const outcome = await pollTxStatus(deploymentId, txHash, signal);
      check();
      if (outcome.status !== "SUCCESS") {
        throw new Error(outcome.errorMessage ?? "Transaction failed on the network");
      }
      toast.success("Transaction confirmed!");
      onSuccess?.();
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
    <button
      onClick={handleClick}
      disabled={busy || disabled}
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
  );
}
