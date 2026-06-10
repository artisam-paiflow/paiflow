"use client";

import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import { getWalletKit } from "./wallet-kit";

function pollTxStatus(
  deploymentId: string,
  txHash: string,
  signal: AbortSignal,
): Promise<{ status: string; errorMessage?: string }> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 60_000;
    const interval = 2_000;

    const check = async () => {
      if (signal.aborted) {
        reject(new Error("Polling aborted"));
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error("Timed out waiting for finality"));
        return;
      }
      try {
        const res = await fetch(`/api/deployments/${deploymentId}/tx-status?txHash=${txHash}`);
        if (!res.ok) {
          reject(new Error("Failed to check transaction status"));
          return;
        }
        const json = (await res.json()) as {
          data: { status: string; errorMessage?: string };
        };
        if (json.data.status === "SUCCESS") {
          resolve({ status: "SUCCESS" });
          return;
        }
        if (json.data.status === "FAILED") {
          resolve({ status: "FAILED", errorMessage: json.data.errorMessage });
          return;
        }
        setTimeout(check, interval);
      } catch {
        reject(new Error("Network error while polling status"));
      }
    };

    setTimeout(check, interval);
  });
}

type ContractCallButtonProps = {
  deploymentId: string;
  network: "testnet" | "mainnet";
  label: string;
  busyLabel: string;
  icon?: string;
  variant?: "primary" | "secondary" | "danger";
  prepare: (address: string) => Promise<{ xdr: string; networkPassphrase: string }>;
  submit: (signedXdr: string) => Promise<{ txHash: string }>;
  onSuccess?: () => void;
};

export default function ContractCallButton({
  deploymentId,
  network,
  label,
  busyLabel,
  icon = "send",
  variant = "primary",
  prepare,
  submit,
  onSuccess,
}: ContractCallButtonProps) {
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const variantClass =
    variant === "primary"
      ? "bg-primary text-on-primary hover:-translate-y-px hover:shadow-[0_0_24px_rgba(255,177,196,0.55)]"
      : variant === "danger"
        ? "bg-error text-on-error hover:-translate-y-px hover:shadow-[0_0_24px_rgba(239,68,68,0.4)]"
        : "border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20";

  const handleClick = useCallback(async () => {
    if (busy) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setBusy(true);

    try {
      const { kit } = await getWalletKit(network);

      await kit.openModal({
        onWalletSelected: async (wallet: { id: string; name: string }) => {
          try {
            toast.info(`Selected wallet: ${wallet.name}`);
            kit.setWallet(wallet.id);

            const { address } = await kit.getAddress();
            toast.success(`Connected: ${address.slice(0, 6)}...${address.slice(-4)}`);

            toast.info("Preparing transaction...");
            const { xdr, networkPassphrase } = await prepare(address);

            toast.info("Awaiting signature...");
            const signed = await kit.signTransaction(xdr, {
              address,
              networkPassphrase,
            });

            toast.info("Submitting transaction...");
            const { txHash } = await submit(signed.signedTxXdr);

            toast.info("Transaction submitted. Waiting for confirmation...");
            const outcome = await pollTxStatus(deploymentId, txHash, abortRef.current!.signal);
            if (outcome.status === "SUCCESS") {
              toast.success("Transaction confirmed!");
              onSuccess?.();
            } else {
              throw new Error(outcome.errorMessage ?? "Transaction failed on the network");
            }
          } catch (err) {
            toast.error((err as Error).message ?? "Transaction failed");
          } finally {
            setBusy(false);
          }
        },
        onClosed: () => {
          toast.warning("Connection cancelled");
          abortRef.current?.abort();
          setBusy(false);
        },
      });
    } catch (err) {
      toast.error((err as Error).message ?? "Connection failed");
      setBusy(false);
    }
  }, [busy, deploymentId, network, prepare, submit, onSuccess]);

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className={`${variantClass} text-label-md inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-mono font-bold transition-all duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none`}
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
