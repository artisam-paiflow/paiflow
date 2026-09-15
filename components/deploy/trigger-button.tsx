"use client";

import { useRef, useState, useEffect } from "react";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-toast";
import { WalletConnectModal } from "@walletconnect/modal";
import { SignClient } from "@walletconnect/sign-client";
import { usePollTxStatus } from "@/lib/hooks/use-poll-tx-status";
import { apiError } from "@/lib/friendly-error";
import { trackWalletConnection } from "@/lib/wallet-tracking";
import { track } from "@/lib/analytics/client";
import { classifyError } from "@/lib/analytics/classify-error";
import { WALLET_CONNECT_UNCONFIGURED, walletConnectProjectId } from "./wallet-connect-config";

type TriggerButtonProps = {
  deploymentId: string;
  network: "testnet" | "mainnet";
  amount: string;
  isDeposit?: boolean;
  mode?: "trigger" | "allowance";
  templateKind?: "SUBSCRIPTION" | "PAYROLL";
};

function isMobile() {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.matchMedia("(pointer:coarse)").matches ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|Opera Mini/u.test(navigator.userAgent),
  );
}

export function TriggerButton({
  deploymentId,
  network,
  amount,
  isDeposit,
  mode = "trigger",
  templateKind,
}: TriggerButtonProps) {
  const [busy, setBusy] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pendingWallet, setPendingWallet] = useState<string | null>(null);
  const [showOpenWallet, setShowOpenWallet] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const selectedWalletRef = useRef<string | null>(null);
  // Where the current attempt got to, so a failure is reported with its stage.
  const attemptRef = useRef<{
    stage: "wallet" | "prepare" | "sign" | "submit" | "onchain" | "status_poll";
    startedAt: number;
    txHash?: string;
  }>({ stage: "wallet", startedAt: 0 });

  function trackTriggerFailure(err: unknown) {
    const { stage, txHash } = attemptRef.current;
    const c = classifyError(err);
    track("trigger_failed", {
      deployment_id: deploymentId,
      stage,
      error_class: c.errorClass,
      error_code: c.errorCode,
      ...(txHash ? { tx_hash: txHash } : {}),
    });
  }
  const pollTxStatus = usePollTxStatus();
  // Pre-warm WalletConnect init on page load so the user doesn't wait
  // when tapping a wallet in the mobile picker.
  useEffect(() => {
    if (isMobile()) {
      ensureWalletConnect().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initLockRef = useRef<Promise<any> | null>(null);
  const wcRef = useRef<{
    client: InstanceType<typeof SignClient> | null;
    modal: WalletConnectModal | null;
    module: any;
    kit: any;
    method: string;
  } | null>(null);

  async function ensureWalletConnect() {
    if (wcRef.current) {
      return wcRef.current;
    }

    if (!initLockRef.current) {
      initLockRef.current = (async () => {
        const [
          { StellarWalletsKit, WalletNetwork, FreighterModule },
          { WalletConnectModule, WalletConnectAllowedMethods },
        ] = await Promise.all([
          import("@creit.tech/stellar-wallets-kit"),
          import("@creit.tech/stellar-wallets-kit/modules/walletconnect.module"),
        ]);

        const walletNetwork = network === "mainnet" ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET;
        const projectId = walletConnectProjectId();

        if (!projectId) {
          // Same guard as wallet-kit.ts: the SDK accepts an undefined project id
          // and fails later on the relay. Mobile has no other wallet path.
          if (isMobile()) throw new Error(WALLET_CONNECT_UNCONFIGURED);
          const kit = new StellarWalletsKit({
            network: walletNetwork,
            modules: [new FreighterModule()],
          });
          wcRef.current = {
            client: null,
            modal: null,
            module: null,
            kit,
            method: WalletConnectAllowedMethods.SIGN,
          };
          return wcRef.current;
        }

        const chain = network === "mainnet" ? "stellar:pubnet" : "stellar:testnet";

        // WalletConnect v2 emits harmless "No matching key. expirer" noise when
        // restoring from localStorage with orphaned topics. Patch it out for init.
        const originalConsoleError = console.error;
        console.error = (...args: any[]) => {
          const msg = args.map(String).join(" ");
          if (msg.includes("No matching key. expirer")) return;
          originalConsoleError.apply(console, args);
        };

        let walletConnectClient;
        try {
          walletConnectClient = await SignClient.init({
            projectId,
            metadata: {
              name: "Paiflow",
              description: "Trigger contract deployments",
              url: typeof window !== "undefined" ? window.location.origin : "",
              icons: ["/logo.png"],
            },
          });
        } finally {
          console.error = originalConsoleError;
        }

        // Remove stale modal elements so we don't accumulate DOM nodes
        document.querySelectorAll("wcm-modal").forEach((el) => el.remove());

        const walletConnectModal = new WalletConnectModal({
          projectId,
          chains: [chain],
          mobileWallets: [
            {
              id: "lobstr",
              name: "LOBSTR",
              links: {
                native: "lobstr",
                universal: "https://lobstr.co/uni/wc",
              },
            },
            {
              id: "xbull",
              name: "xBull",
              links: {
                native: "xbull",
                universal: "https://xbull.app",
              },
            },
            {
              id: "freighter",
              name: "Freighter",
              links: {
                native: "freighterwallet://wc-redirect",
                universal: "",
              },
            },
          ],
          walletImages: {
            lobstr: "https://stellar.creit.tech/wallet-icons/lobstr.png",
            xbull: "https://stellar.creit.tech/wallet-icons/xbull.png",
            freighter: "https://stellar.creit.tech/wallet-icons/freighter.png",
          },
          enableExplorer: true,
        });

        const walletConnectModule = new WalletConnectModule({
          projectId,
          name: "Paiflow",
          description: "Trigger contract deployments",
          url: typeof window !== "undefined" ? window.location.origin : "",
          icons: ["/logo.png"],
          method: WalletConnectAllowedMethods.SIGN,
          network: walletNetwork,
          client:
            walletConnectClient as unknown as typeof import("@walletconnect/sign-client").SignClient,
          modal: walletConnectModal,
        });

        const modules = isMobile()
          ? [walletConnectModule]
          : [new FreighterModule(), walletConnectModule];

        const kit = new StellarWalletsKit({
          network: walletNetwork,
          modules,
        });

        wcRef.current = {
          client: walletConnectClient,
          modal: walletConnectModal,
          module: walletConnectModule,
          kit,
          method: WalletConnectAllowedMethods.SIGN,
        };

        return wcRef.current;
      })();

      initLockRef.current.catch(() => {
        initLockRef.current = null;
      });
    }

    return initLockRef.current;
  }

  async function prepareWalletConnectSession(walletConnectModule: any) {
    const sessions = await walletConnectModule.getSessions();
    if (sessions.length === 0) {
      toast.info("Initiating WalletConnect session...");
      await walletConnectModule.connectWalletConnect();
      toast.info("Session established, getting address...");
    } else {
      walletConnectModule.setSession(sessions[0].id);
      toast.info("Reusing existing session...");
    }
  }

  async function runDesktopFlow() {
    const { kit, module: walletConnectModule } = await ensureWalletConnect();

    await kit.openModal({
      onWalletSelected: async (wallet: { id: string; name: string }) => {
        setBusy(true);
        try {
          toast.info(`Selected wallet: ${wallet.name}`);
          kit.setWallet(wallet.id);
          const isWalletConnect = wallet.id === "wallet_connect";

          if (isWalletConnect) {
            await prepareWalletConnectSession(walletConnectModule);
          } else {
            toast.info("Connecting to Freighter extension...");
          }

          const { address } = await kit.getAddress();
          toast.success(`Connected: ${address.slice(0, 6)}...${address.slice(-4)}`);
          void trackWalletConnection({ address, network, walletId: wallet.id, surface: "trigger" });

          await submitTrigger(address, kit);
        } catch (err) {
          trackTriggerFailure(err);
          toastError(err, "Connection failed");
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
  }

  async function submitTrigger(
    address: string,
    kit: {
      getAddress: () => Promise<{ address: string }>;
      signTransaction: (
        xdr: string,
        opts: { address?: string; networkPassphrase: string },
      ) => Promise<{ signedTxXdr: string }>;
    },
    onAwaitingSignature?: () => void,
  ) {
    attemptRef.current.stage = "prepare";
    toast.info("Preparing transaction...");
    const preparePath =
      mode === "allowance"
        ? templateKind === "PAYROLL"
          ? `/api/deployments/${deploymentId}/payroll-allowance`
          : `/api/deployments/${deploymentId}/subscription-allowance`
        : `/api/deployments/${deploymentId}/trigger`;
    const submitPath =
      mode === "allowance"
        ? `/api/deployments/${deploymentId}/submit-invoke`
        : `/api/deployments/${deploymentId}/submit-trigger`;
    const res = await fetch(preparePath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount, userAddress: address }),
    });
    const data = await res.json();
    if (!res.ok) throw apiError(data, "Failed to prepare transaction");

    const xdr = data.data.xdr ?? data.data.unsignedXdr;
    if (!xdr) throw new Error("No transaction XDR returned");

    // Prevent WalletConnect from auto-redirecting to a stale wallet choice
    // (e.g. MetaMask) during signing, which causes an Android intent chooser.
    try {
      localStorage.removeItem("WALLETCONNECT_DEEPLINK_CHOICE");
    } catch {
      /* ignore */
    }

    onAwaitingSignature?.();
    attemptRef.current.stage = "sign";
    toast.info("Awaiting signature...");
    const signed = await kit.signTransaction(xdr, {
      address,
      networkPassphrase: data.data.networkPassphrase,
    });

    attemptRef.current.stage = "submit";
    toast.info("Submitting transaction...");
    const submit = await fetch(submitPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signedXdr: signed.signedTxXdr }),
    });
    const subData = await submit.json();
    if (!submit.ok) throw apiError(subData, "Submit failed");

    const txHash = subData.data.txHash as string;
    attemptRef.current.txHash = txHash;
    attemptRef.current.stage = "status_poll";
    toast.info("Transaction submitted. Waiting for confirmation...");

    const outcome = await pollTxStatus(deploymentId, txHash, abortRef.current!.signal);
    if (outcome.status === "SUCCESS") {
      track("trigger_succeeded", {
        deployment_id: deploymentId,
        tx_hash: txHash,
        elapsed_ms: Date.now() - attemptRef.current.startedAt,
      });
      if (mode === "allowance") {
        toast.success("Allowance approved!");
      } else {
        toast.success(isDeposit ? "Deposited!" : "Distribution triggered!");
      }
    } else {
      attemptRef.current.stage = "onchain";
      throw new Error(outcome.errorMessage ?? "Transaction failed on the network");
    }
  }

  useEffect(() => {
    const raw = sessionStorage.getItem("paiflow_pending_wc");
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as { network: string; timestamp: number; walletId?: string };
      if (Date.now() - data.timestamp > 120_000) {
        sessionStorage.removeItem("paiflow_pending_wc");
        return;
      }
      if (data.network !== network) return;
      if (data.walletId) selectedWalletRef.current = data.walletId;

      attemptRef.current = { stage: "wallet", startedAt: data.timestamp };
      setBusy(true);
      ensureWalletConnect()
        .then(async ({ kit, module: walletConnectModule }) => {
          if (!walletConnectModule) throw new Error(WALLET_CONNECT_UNCONFIGURED);
          kit.setWallet("wallet_connect");
          const sessions = await walletConnectModule.getSessions();
          if (sessions.length === 0) {
            throw new Error("No session found after returning from wallet");
          }
          walletConnectModule.setSession(sessions[0].id);
          sessionStorage.removeItem("paiflow_pending_wc");
          const { address } = await kit.getAddress();
          toast.success(`Connected: ${address.slice(0, 6)}...${address.slice(-4)}`);
          await submitTrigger(address, kit, () => setShowOpenWallet(true));
        })
        .catch((err) => {
          sessionStorage.removeItem("paiflow_pending_wc");
          trackTriggerFailure(err);
          toastError(err, "Connection failed");
        })
        .finally(() => {
          setBusy(false);
          setShowPicker(false);
          setShowOpenWallet(false);
        });
    } catch {
      sessionStorage.removeItem("paiflow_pending_wc");
    }
  }, [network]);

  async function openMobileWallet(walletId: string) {
    selectedWalletRef.current = walletId;
    setPendingWallet(walletId);
    setBusy(true);
    try {
      const { kit, module: walletConnectModule, client, method } = await ensureWalletConnect();
      if (!client || !walletConnectModule) throw new Error(WALLET_CONNECT_UNCONFIGURED);
      kit.setWallet("wallet_connect");

      const sessions = await walletConnectModule.getSessions();
      if (sessions.length > 0) {
        walletConnectModule.setSession(sessions[0].id);
      } else {
        toast.info("Preparing connection...");
        const { uri, approval } = await client.connect({
          requiredNamespaces: {
            stellar: {
              methods: [method],
              chains: [network === "mainnet" ? "stellar:pubnet" : "stellar:testnet"],
              events: [],
            },
          },
        });

        const links: Record<string, string> = {
          freighter: `freighterwallet://wc?uri=${encodeURIComponent(uri)}`,
          lobstr: `lobstr://wc?uri=${encodeURIComponent(uri)}`,
          xbull: `xbull://wc?uri=${encodeURIComponent(uri)}`,
        };

        sessionStorage.setItem(
          "paiflow_pending_wc",
          JSON.stringify({ network, timestamp: Date.now(), walletId }),
        );

        const link = links[walletId];
        if (!link) throw new Error("Unknown wallet");
        window.open(link, "_self", "noreferrer noopener");

        const session = await Promise.race([
          approval(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Wallet connection timed out")), 60_000),
          ),
        ]);
        walletConnectModule.setSession(session.topic);
        sessionStorage.removeItem("paiflow_pending_wc");
      }

      setShowPicker(false);
      const { address } = await kit.getAddress();
      toast.success(`Connected: ${address.slice(0, 6)}...${address.slice(-4)}`);
      void trackWalletConnection({
        address,
        network,
        walletId,
        surface: "trigger",
      });
      await submitTrigger(address, kit, () => setShowOpenWallet(true));
    } catch (err) {
      trackTriggerFailure(err);
      toastError(err, "Connection failed");
      sessionStorage.removeItem("paiflow_pending_wc");
    } finally {
      setBusy(false);
      setPendingWallet(null);
      setShowPicker(false);
      setShowOpenWallet(false);
    }
  }

  async function onTrigger() {
    if (showPicker) return;
    if (!amount || !/^\d+$/.test(amount) || amount === "0") {
      toast.error("Enter a valid amount");
      return;
    }
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setShowOpenWallet(false);
    attemptRef.current = { stage: "wallet", startedAt: Date.now() };
    track("trigger_started", { deployment_id: deploymentId, mode, amount_stroops: amount });

    if (isMobile()) {
      setShowPicker(true);
    } else {
      setBusy(true);
      try {
        await runDesktopFlow();
      } catch (err) {
        trackTriggerFailure(err);
        toastError(err, isDeposit ? "Deposit failed" : "Trigger failed");
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <>
      {showPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-background-1 relative w-full max-w-xs rounded-2xl p-6 shadow-2xl">
            {busy && (
              <div className="bg-background-1/90 absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl backdrop-blur-sm">
                <span className="material-symbols-outlined text-primary animate-spin text-2xl">
                  progress_activity
                </span>
                <p className="text-label-sm text-on-background mt-2 font-medium">
                  {pendingWallet ? `Opening ${pendingWallet}…` : "Connecting…"}
                </p>
              </div>
            )}
            <h3 className="text-label-lg text-on-background mb-1 text-center font-bold">
              Select Wallet
            </h3>
            <p className="text-body-sm text-on-background/60 mb-5 text-center">
              Choose a wallet to connect
            </p>
            <div className="space-y-3">
              <button
                onClick={() => openMobileWallet("freighter")}
                disabled={busy}
                className="bg-background-2 hover:bg-background-3 disabled:hover:bg-background-2 flex w-full items-center gap-3 rounded-xl p-3 transition-colors disabled:opacity-50"
              >
                <img
                  src="https://stellar.creit.tech/wallet-icons/freighter.png"
                  alt=""
                  className="h-10 w-10 rounded-lg"
                />
                <span className="text-label-sm text-on-background font-medium">Freighter</span>
              </button>
              <button
                onClick={() => openMobileWallet("lobstr")}
                disabled={busy}
                className="bg-background-2 hover:bg-background-3 disabled:hover:bg-background-2 flex w-full items-center gap-3 rounded-xl p-3 transition-colors disabled:opacity-50"
              >
                <img
                  src="https://stellar.creit.tech/wallet-icons/lobstr.png"
                  alt=""
                  className="h-10 w-10 rounded-lg"
                />
                <span className="text-label-sm text-on-background font-medium">LOBSTR</span>
              </button>
              <button
                onClick={() => openMobileWallet("xbull")}
                disabled={busy}
                className="bg-background-2 hover:bg-background-3 disabled:hover:bg-background-2 flex w-full items-center gap-3 rounded-xl p-3 transition-colors disabled:opacity-50"
              >
                <img
                  src="https://stellar.creit.tech/wallet-icons/xbull.png"
                  alt=""
                  className="h-10 w-10 rounded-lg"
                />
                <span className="text-label-sm text-on-background font-medium">xBull</span>
              </button>
            </div>
            <button
              onClick={() => {
                if (busy) return;
                setShowPicker(false);
                abortRef.current?.abort();
              }}
              disabled={busy}
              className="hover:bg-background-2 text-label-sm text-on-background/80 mt-4 w-full rounded-xl py-3 font-medium transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <button
        onClick={onTrigger}
        disabled={busy || showPicker}
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
            {mode === "allowance"
              ? "CONNECT WALLET & APPROVE"
              : isDeposit
                ? "CONNECT WALLET & DEPOSIT"
                : "CONNECT WALLET & TRIGGER"}
          </>
        )}
      </button>

      {isMobile() && showOpenWallet && selectedWalletRef.current && (
        <button
          onClick={() => {
            const schemes: Record<string, string> = {
              freighter: "freighterwallet://",
              lobstr: "lobstr://",
              xbull: "xbull://",
            };
            const scheme = schemes[selectedWalletRef.current!];
            if (scheme) window.open(scheme, "_self");
          }}
          className="border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20 mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-3 font-mono text-xs font-bold transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">open_in_new</span>
          OPEN {selectedWalletRef.current.toUpperCase()}
        </button>
      )}
    </>
  );
}
