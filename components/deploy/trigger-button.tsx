"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

type TriggerButtonProps = {
  deploymentId: string;
  network: "testnet" | "mainnet";
  amount: string;
};

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

export function TriggerButton({ deploymentId, network, amount }: TriggerButtonProps) {
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function onTrigger() {
    if (!amount || !/^\d+$/.test(amount) || amount === "0") {
      toast.error("Enter a valid XLM amount");
      return;
    }
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setBusy(true);
    try {
      const [
        { StellarWalletsKit, WalletNetwork, FreighterModule },
        { WalletConnectModule, WalletConnectAllowedMethods },
      ] = await Promise.all([
        import("@creit.tech/stellar-wallets-kit"),
        import("@creit.tech/stellar-wallets-kit/modules/walletconnect.module"),
      ]);

      const walletConnectModule = new WalletConnectModule({
        projectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID!,
        name: "Pinkraft",
        description: "Trigger contract deployments",
        url: typeof window !== "undefined" ? window.location.origin : "",
        icons: ["https://pinkraft.xyz/logo.png"],
        method: WalletConnectAllowedMethods.SIGN,
        network: network === "mainnet" ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET,
      });

      const kit = new StellarWalletsKit({
        network: network === "mainnet" ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET,
        modules: [new FreighterModule(), walletConnectModule],
      });

      await kit.openModal({
        onWalletSelected: async (wallet) => {
          setBusy(true);
          try {
            toast.info(`Selected wallet: ${wallet.name}`);
            kit.setWallet(wallet.id);
            const isWalletConnect = wallet.id === "wallet_connect";

            if (isWalletConnect) {
              toast.info("Initiating WalletConnect session...");
              await walletConnectModule.connectWalletConnect();
              toast.info("Session established, getting address...");
            } else {
              toast.info("Connecting to Freighter extension...");
            }

            const { address } = await kit.getAddress();
            toast.success(`Connected: ${address.slice(0, 6)}...${address.slice(-4)}`);

            toast.info("Preparing transaction...");
            const res = await fetch(`/api/deployments/${deploymentId}/trigger`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ amount, userAddress: address }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error?.message ?? "Failed to prepare transaction");

            toast.info("Awaiting signature from Freighter Mobile...");
            const signed = await kit.signTransaction(data.data.xdr, {
              address,
              networkPassphrase: data.data.networkPassphrase,
            });

            toast.info("Submitting transaction...");
            const submit = await fetch(`/api/deployments/${deploymentId}/submit-trigger`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ signedXdr: signed.signedTxXdr }),
            });
            const subData = await submit.json();
            if (!submit.ok) throw new Error(subData?.error?.message ?? "Submit failed");

            const txHash = subData.data.txHash as string;
            toast.info("Transaction submitted. Waiting for confirmation...");

            const outcome = await pollTxStatus(deploymentId, txHash, abortRef.current!.signal);
            if (outcome.status === "SUCCESS") {
              toast.success("Distribution triggered!");
            } else {
              throw new Error(outcome.errorMessage ?? "Transaction failed on the network");
            }
          } catch (err) {
            toast.error((err as Error).message ?? "Connection failed");
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
      toast.error((err as Error).message ?? "Trigger failed");
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
