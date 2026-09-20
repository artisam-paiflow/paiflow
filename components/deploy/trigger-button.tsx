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
import {
  isExpiredSession,
  isLiveSession,
  isPairingFresh,
  PAIRING_STALE_MARGIN_MS,
  pairingExpiresAt,
  sessionHasChain,
  sessionMatchesWallet,
  stellarChainId,
  WALLET_CONNECT_UNCONFIGURED,
  walletConnectProjectId,
} from "./wallet-connect-config";

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

const WALLET_DEEP_LINKS: Record<string, (uri: string) => string> = {
  freighter: (uri) => `freighterwallet://wc?uri=${encodeURIComponent(uri)}`,
  lobstr: (uri) => `lobstr://wc?uri=${encodeURIComponent(uri)}`,
  xbull: (uri) => `xbull://wc?uri=${encodeURIComponent(uri)}`,
};

/**
 * Topics of stored sessions usable *for this call*, best first.
 *
 * Two hard filters: the session must still be live, and it must authorize the
 * chain we are about to use. `preferWalletId` only *ranks* — it never excludes.
 * Peer metadata is self-reported by the wallet, so it cannot carry a trust
 * decision (see `sessionMatchesWallet`), and using it to exclude would break
 * the return-from-wallet path whenever a wallet reports a name we do not
 * recognize (#598 review).
 *
 * Provably expired rows are dropped from the local store as a side effect: the
 * kit picks a session by scanning that store, so leaving one there lets it
 * shadow a fresh pairing. `session.delete` is local only and never touches the
 * relay — a `disconnect` would publish, and publishing to a session the relay
 * has forgotten is exactly the 60-second stall this exists to avoid (#594).
 *
 * The liveness and expiry predicates are asymmetric on purpose: a session that
 * is not usable is not necessarily safe to destroy. Only the expiry margin and
 * a chain mismatch cause a skip; only a passed expiry causes a delete.
 */
type StoredSession = InstanceType<typeof SignClient>["session"]["values"][number];

function usableSessionTopics(
  client: InstanceType<typeof SignClient> | null,
  { chain, preferWalletId }: { chain: string; preferWalletId?: string | null },
): string[] {
  if (!client) return [];
  const usable: StoredSession[] = [];
  for (const session of client.session.values) {
    if (isExpiredSession(session)) {
      void client.session
        .delete(session.topic, { code: 6000, message: "Session expired" })
        .catch(() => {});
      continue;
    }
    if (!isLiveSession(session)) continue;
    if (!sessionHasChain(session, chain)) continue;
    usable.push(session);
  }
  const rank = (session: StoredSession) =>
    preferWalletId && sessionMatchesWallet(session.peer?.metadata?.name, preferWalletId) ? 0 : 1;
  return usable
    .sort((a, b) => rank(a) - rank(b) || b.expiry - a.expiry)
    .map((session) => session.topic);
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
  // Pairing happens on page load, not on the wallet tap. Android Chrome
  // launches a custom-scheme app only while the tap's user activation is still
  // live — measured dead by 11s, and awaiting connect() on the tap took ~11s
  // against the live relay — so nothing may be awaited between tap and
  // navigation (#594). A pairing is good for five minutes, so its freshness is
  // rechecked when the picker opens.
  const readyRef = useRef<{
    uri: string;
    approval: () => Promise<{ topic: string }>;
    expiresAt: number;
  } | null>(null);
  // One in-flight pairing attempt, shared by the page-load effect and the
  // picker. Without it a late failure from the older attempt can overwrite a
  // newer "ready" with "failed", disabling the picker while a perfectly good
  // pairing sits in readyRef (#598 review).
  const pairingInFlightRef = useRef<Promise<void> | null>(null);
  // Silent re-pair scheduled for just before the current pairing goes stale, so
  // a picker left open still navigates with a live URI.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pairingState, setPairingState] = useState<"idle" | "preparing" | "ready" | "failed">(
    "idle",
  );
  const abortRef = useRef<AbortController | null>(null);
  // Wallet-kit 1.9.5 can still fire onClosed after a wallet was picked: the
  // modal waits 280ms before dispatching wallet-selected, its backdrop stays
  // clickable meanwhile, and openModal never detaches the modal-closed
  // listener on selection. Once this is set, a close is not a cancellation.
  const signingStartedRef = useRef(false);
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
      void beginPairing({ silent: true });
    }
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
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

  async function prepareWalletConnectSession(
    walletConnectModule: any,
    client: InstanceType<typeof SignClient> | null,
  ) {
    const [liveTopic] = usableSessionTopics(client, { chain: stellarChainId(network) });
    if (!liveTopic) {
      toast.info("Initiating WalletConnect session...");
      await walletConnectModule.connectWalletConnect();
      toast.info("Session established, getting address...");
      return;
    }
    walletConnectModule.setSession(liveTopic);
    toast.info("Reusing existing session...");
  }

  async function runDesktopFlow() {
    const { kit, module: walletConnectModule, client } = await ensureWalletConnect();

    signingStartedRef.current = false;
    await kit.openModal({
      onWalletSelected: async (wallet: { id: string; name: string }) => {
        signingStartedRef.current = true;
        setBusy(true);
        try {
          toast.info(`Selected wallet: ${wallet.name}`);
          kit.setWallet(wallet.id);
          const isWalletConnect = wallet.id === "wallet_connect";

          if (isWalletConnect) {
            await prepareWalletConnectSession(walletConnectModule, client);
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
        if (signingStartedRef.current) return;
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
    // Created here, not in onTrigger: the WalletConnect resume effect runs on a
    // fresh mount and calls this directly, so it used to reach the poll with no
    // controller and throw after the transaction was already broadcast (#451).
    const controller = new AbortController();
    abortRef.current = controller;

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

    const outcome = await pollTxStatus(deploymentId, txHash, controller.signal);
    if (outcome.status === "SUCCESS") {
      track("trigger_succeeded", {
        deployment_id: deploymentId,
        tx_hash: txHash,
        signer_address: address,
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
        .then(async ({ kit, module: walletConnectModule, client }) => {
          if (!walletConnectModule) throw new Error(WALLET_CONNECT_UNCONFIGURED);
          kit.setWallet("wallet_connect");
          const [topic] = usableSessionTopics(client, {
            chain: stellarChainId(network),
            preferWalletId: data.walletId,
          });
          if (!topic) {
            throw new Error("No session found after returning from wallet");
          }
          walletConnectModule.setSession(topic);
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

  /** Whether a wallet tap can navigate right now with no await in the way. */
  function isReadyToTap(): boolean {
    return isPairingFresh(readyRef.current?.expiresAt);
  }

  function schedulePairingRefresh(expiresAt: number) {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const delay = expiresAt - PAIRING_STALE_MARGIN_MS - Date.now();
    refreshTimerRef.current = setTimeout(
      () => void beginPairing({ silent: true }),
      Math.max(delay, 1_000),
    );
  }

  function beginPairing({ silent = false }: { silent?: boolean } = {}): Promise<void> {
    // Join the attempt already running rather than racing a second one.
    if (pairingInFlightRef.current) return pairingInFlightRef.current;

    const attempt = (async () => {
      readyRef.current = null;
      setPairingState("preparing");
      try {
        const { client, module: walletConnectModule, method } = await ensureWalletConnect();
        if (!client || !walletConnectModule) throw new Error(WALLET_CONNECT_UNCONFIGURED);

        // A pairing is always prepared, even when a reusable session exists:
        // the wallet is not chosen until the tap, and only then can a session
        // be matched to it. An unused pairing simply expires.
        const { uri, approval } = await client.connect({
          requiredNamespaces: {
            stellar: {
              methods: [method],
              chains: [stellarChainId(network)],
              events: [],
            },
          },
        });
        if (!uri) throw new Error("WalletConnect returned no pairing URI");
        const expiresAt = pairingExpiresAt(uri);
        readyRef.current = { uri, approval, expiresAt };
        setPairingState("ready");
        schedulePairingRefresh(expiresAt);
      } catch (err) {
        setPairingState("failed");
        // On page load nobody has asked for a wallet yet, so a toast and a
        // trigger_failed event would both be noise. The retry when the picker
        // opens is the one that reports.
        if (!silent) {
          trackTriggerFailure(err);
          toastError(err, "Connection failed");
        }
      } finally {
        pairingInFlightRef.current = null;
      }
    })();

    pairingInFlightRef.current = attempt;
    return attempt;
  }

  // Synchronous by design: the scheme navigation has to happen inside the tap's
  // user activation, so nothing may be awaited before window.open. Everything
  // that awaits lives in completeMobileConnect.
  function openMobileWallet(walletId: string) {
    const deepLink = WALLET_DEEP_LINKS[walletId];
    if (!deepLink) {
      toast.error("Unknown wallet");
      return;
    }
    selectedWalletRef.current = walletId;

    // A stored session is deliberately NOT reused here. Nothing in WalletConnect
    // v2 attests a session's wallet to the dApp -- peer metadata is self-reported
    // and Verify attests our origin to the wallet, not the reverse -- so reusing
    // one could silently connect a wallet the user did not tap. Always pairing
    // costs a returning user one approval; they must open the wallet to sign
    // either way (#598 review).
    //
    // Freshness is rechecked here, not just when the picker opened: a picker
    // left open outlives a five-minute pairing, and handing the wallet a dead
    // URI reproduces the original #594 silence. The refresh timer normally
    // prevents this; this is the backstop.
    const pairing = readyRef.current;
    if (!pairing || !isPairingFresh(pairing.expiresAt)) {
      void beginPairing();
      return;
    }

    setPendingWallet(walletId);
    setBusy(true);
    sessionStorage.setItem(
      "paiflow_pending_wc",
      JSON.stringify({ network, timestamp: Date.now(), walletId }),
    );
    window.open(deepLink(pairing.uri), "_self", "noreferrer noopener");
    void completeMobileConnect({ pairing });
  }

  async function completeMobileConnect({
    pairing,
  }: {
    pairing: { approval: () => Promise<{ topic: string }> };
  }) {
    try {
      const { kit, module: walletConnectModule, client } = await ensureWalletConnect();
      if (!client || !walletConnectModule) throw new Error(WALLET_CONNECT_UNCONFIGURED);
      kit.setWallet("wallet_connect");

      const session = await Promise.race([
        pairing.approval(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Wallet connection timed out")), 60_000),
        ),
      ]);
      readyRef.current = null;
      setPairingState("idle");
      walletConnectModule.setSession(session.topic);
      sessionStorage.removeItem("paiflow_pending_wc");
      // The pairing is spent; line up a fresh one for the next attempt.
      void beginPairing({ silent: true });

      setShowPicker(false);
      const { address } = await kit.getAddress();
      toast.success(`Connected: ${address.slice(0, 6)}...${address.slice(-4)}`);
      void trackWalletConnection({
        address,
        network,
        walletId: selectedWalletRef.current ?? "wallet_connect",
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
    setShowOpenWallet(false);
    attemptRef.current = { stage: "wallet", startedAt: Date.now() };
    track("trigger_started", { deployment_id: deploymentId, mode, amount_stroops: amount });

    if (isMobile()) {
      setShowPicker(true);
      // Pairing normally happened on load; re-pair only if it has gone stale,
      // expired, or never succeeded.
      if (isReadyToTap()) {
        setPairingState("ready");
      } else {
        void beginPairing();
      }
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
                  {pendingWallet ? `Waiting for ${pendingWallet}…` : "Connecting…"}
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
                disabled={busy || pairingState !== "ready"}
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
                disabled={busy || pairingState !== "ready"}
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
                disabled={busy || pairingState !== "ready"}
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
            {pairingState !== "ready" && !busy && (
              <p className="text-body-sm text-on-background/60 mt-4 text-center">
                {pairingState === "failed"
                  ? "Could not reach the wallet network. Close this and try again."
                  : "Preparing connection…"}
              </p>
            )}
            <button
              onClick={() => {
                if (busy) return;
                setShowPicker(false);
                // The pairing is deliberately kept: it was created on load, is
                // good for five minutes, and a cancel here is usually a change
                // of mind rather than a failure. An in-flight connect() cannot
                // be cancelled either way.
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
