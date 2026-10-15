"use client";

import { useRef, useState, useEffect } from "react";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-toast";
import { usePollTxStatus } from "@/lib/hooks/use-poll-tx-status";
import { apiError } from "@/lib/friendly-error";
import { trackWalletConnection } from "@/lib/wallet-tracking";
import { track } from "@/lib/analytics/client";
import { classifyError } from "@/lib/analytics/classify-error";
import { mobileWalletLink } from "./mobile-wallet-links";
import { approvedMobileSession, type MobileWalletSession } from "./mobile-wallet-session";
import {
  getCachedWalletKit,
  getWalletKit,
  type WalletConnectClient,
  type WalletKit,
} from "./wallet-kit";
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
} from "./wallet-connect-config";

type TriggerButtonProps = {
  deploymentId: string;
  network: "testnet" | "mainnet";
  amount: string;
  isDeposit?: boolean;
  mode?: "trigger" | "allowance";
  templateKind?: "SUBSCRIPTION" | "PAYROLL";
  disabled?: boolean;
};

function isMobile() {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.matchMedia("(pointer:coarse)").matches ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|Opera Mini/u.test(navigator.userAgent),
  );
}

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
type StoredSession = WalletConnectClient["session"]["values"][number];

function usableSessionTopics(
  client: WalletConnectClient | null,
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
  disabled = false,
}: TriggerButtonProps) {
  const [busy, setBusy] = useState(false);
  const allowanceIntentRef = useRef<string | null>(null);
  const [pendingAllowanceHash, setPendingAllowanceHash] = useState<string | null>(null);
  const [allowanceMessage, setAllowanceMessage] = useState<string | null>(null);
  const isPublicAllowance = mode === "allowance" && templateKind !== "PAYROLL";
  const allowanceStorageKey = `paiflow_allowance_pending:${deploymentId}:${network}`;

  function rememberAllowance(hash: string | null, intent?: string) {
    setPendingAllowanceHash(hash);
    if (intent) allowanceIntentRef.current = intent;
    if (!hash) allowanceIntentRef.current = null;
    try {
      if (hash)
        localStorage.setItem(
          allowanceStorageKey,
          JSON.stringify({ txHash: hash, intent: allowanceIntentRef.current }),
        );
      else localStorage.removeItem(allowanceStorageKey);
    } catch {
      /* Storage may be disabled; retain the in-memory hash. */
    }
  }

  async function checkAllowanceStatus(hash: string, signal?: AbortSignal) {
    setAllowanceMessage(`Checking approval ${hash}`);
    try {
      const outcome = await pollTxStatus(
        deploymentId,
        hash,
        signal,
        allowanceIntentRef.current
          ? `/api/deployments/${deploymentId}/subscription-allowance/status?intent=${encodeURIComponent(allowanceIntentRef.current)}`
          : undefined,
      );
      rememberAllowance(null);
      if (outcome.status === "SUCCESS") {
        setAllowanceMessage(`Allowance confirmed: ${hash}`);
        toast.success("Allowance approved!");
      } else {
        setAllowanceMessage(
          `${outcome.errorMessage ?? "Approval failed on the network"}: ${hash}. You can try again.`,
        );
      }
      return outcome;
    } catch {
      setAllowanceMessage(
        `Confirmation is still unknown for ${hash}. Check its status before approving again.`,
      );
      return null;
    }
  }

  useEffect(() => {
    if (!isPublicAllowance) return;
    let hash: string | null = null;
    try {
      const stored = localStorage.getItem(allowanceStorageKey);
      if (stored) {
        const pending = JSON.parse(stored) as { txHash?: unknown; intent?: unknown };
        if (typeof pending.txHash === "string" && typeof pending.intent === "string") {
          hash = pending.txHash;
          allowanceIntentRef.current = pending.intent;
        }
      }
    } catch {
      /* optional storage */
    }
    if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return;
    setPendingAllowanceHash(hash);
    const controller = new AbortController();
    setBusy(true);
    void checkAllowanceStatus(hash, controller.signal).finally(() => setBusy(false));
    return () => controller.abort();
    // Resume the existing hash when returning from a wallet or reloading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowanceStorageKey, isPublicAllowance]);
  const [showPicker, setShowPicker] = useState(false);
  const [pendingWallet, setPendingWallet] = useState<string | null>(null);
  const [showOpenWallet, setShowOpenWallet] = useState(false);
  const [connectedWallet, setConnectedWallet] = useState<MobileWalletSession | null>(null);
  const mobileSessionKey = `paiflow_mobile_wallet:${network}`;

  function storedMobileSession(client: WalletConnectClient | null) {
    if (!client) return null;
    try {
      return approvedMobileSession(
        JSON.parse(localStorage.getItem(mobileSessionKey) ?? "null"),
        client.session.values,
        network,
      );
    } catch {
      return null;
    }
  }

  function rememberMobileSession(session: MobileWalletSession) {
    setConnectedWallet(session);
    try {
      localStorage.setItem(mobileSessionKey, JSON.stringify(session));
    } catch {
      /* The connection can still be reused in this page when storage is disabled. */
    }
  }
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
      void getWalletKit(network)
        .then(({ client }) => {
          const session = storedMobileSession(client);
          if (session) setConnectedWallet(session);
          else void beginPairing({ silent: true });
        })
        .catch(() => void beginPairing({ silent: true }));
    }
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function prepareWalletConnectSession(
    walletConnectModule: NonNullable<WalletKit["module"]>,
    client: WalletConnectClient | null,
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
    const { kit, module: walletConnectModule, client } = await getWalletKit(network);

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
            if (!walletConnectModule) throw new Error(WALLET_CONNECT_UNCONFIGURED);
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
        ? isPublicAllowance
          ? `/api/deployments/${deploymentId}/subscription-allowance/submit`
          : `/api/deployments/${deploymentId}/submit-invoke`
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
    if (isPublicAllowance) {
      const txHash = data.data.txHash as string;
      if (!/^[a-f0-9]{64}$/.test(txHash) || typeof data.data.intent !== "string")
        throw new Error("Missing allowance approval intent");
      rememberAllowance(txHash, data.data.intent);
      attemptRef.current.txHash = txHash;
      // Save the hash and scoped intent before sending: a lost response can
      // be reconciled without storing or re-signing the customer envelope.
      let refusal: Error | null = null;
      try {
        const submit = await fetch(submitPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ signedXdr: signed.signedTxXdr, intent: data.data.intent }),
        });
        const result = await submit.json();
        if (!submit.ok) {
          // A definite validation refusal means the server never sent it.
          if (submit.status >= 400 && submit.status < 500)
            refusal = apiError(result, "Approval refused");
        }
      } catch {
        // Transport/5xx uncertainty is resolved against the prepared hash.
      }
      if (refusal) {
        rememberAllowance(null);
        setAllowanceMessage(null);
        throw refusal;
      }
      attemptRef.current.stage = "status_poll";
      const outcome = await checkAllowanceStatus(txHash, controller.signal);
      if (outcome?.status === "SUCCESS")
        track("trigger_succeeded", {
          deployment_id: deploymentId,
          tx_hash: txHash,
          signer_address: address,
          elapsed_ms: Date.now() - attemptRef.current.startedAt,
        });
      return;
    }
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
      const data = JSON.parse(raw) as {
        network: string;
        timestamp: number;
        walletId?: string;
        pairingTopic?: string;
      };
      if (Date.now() - data.timestamp > 120_000) {
        sessionStorage.removeItem("paiflow_pending_wc");
        return;
      }
      if (data.network !== network) return;
      if (data.walletId) selectedWalletRef.current = data.walletId;

      attemptRef.current = { stage: "wallet", startedAt: data.timestamp };
      setBusy(true);
      getWalletKit(network)
        .then(async ({ kit, module: walletConnectModule, client }) => {
          if (!walletConnectModule) throw new Error(WALLET_CONNECT_UNCONFIGURED);
          kit.setWallet("wallet_connect");
          // New pending attempts identify their exact pairing. An older saved
          // connection must not replace the one just approved after a reload.
          const [topic] = data.pairingTopic
            ? (client?.session.values ?? [])
                .filter(
                  (session: StoredSession) =>
                    session.pairingTopic === data.pairingTopic &&
                    isLiveSession(session) &&
                    sessionHasChain(session, stellarChainId(network)),
                )
                .map((session: StoredSession) => session.topic)
            : usableSessionTopics(client, {
                chain: stellarChainId(network),
                preferWalletId: data.walletId,
              });
          if (!topic) {
            throw new Error("No session found after returning from wallet");
          }
          walletConnectModule.setSession(topic);
          sessionStorage.removeItem("paiflow_pending_wc");
          const { address } = await kit.getAddress();
          if (data.pairingTopic && data.walletId && client) {
            const remembered = approvedMobileSession(
              { topic, address, walletId: data.walletId },
              client.session.values,
              network,
            );
            if (remembered) rememberMobileSession(remembered);
          }
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
        const { client, module: walletConnectModule, method } = await getWalletKit(network);
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
    if (!mobileWalletLink(walletId)) {
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
      JSON.stringify({
        network,
        timestamp: Date.now(),
        walletId,
        pairingTopic: /^wc:([^@]+)@2\?/u.exec(pairing.uri)?.[1],
      }),
    );
    window.open(mobileWalletLink(walletId, pairing.uri)!, "_self", "noreferrer noopener");
    void completeMobileConnect({ pairing });
  }

  async function completeMobileConnect({
    pairing,
  }: {
    pairing: { approval: () => Promise<{ topic: string }> };
  }) {
    try {
      const { kit, module: walletConnectModule, client } = await getWalletKit(network);
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
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);

      setShowPicker(false);
      const { address } = await kit.getAddress();
      if (selectedWalletRef.current)
        rememberMobileSession({
          topic: session.topic,
          walletId: selectedWalletRef.current,
          address,
        });
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

  async function continueMobileSession() {
    if (!connectedWallet || busy) return;
    setBusy(true);
    setShowPicker(false);
    selectedWalletRef.current = connectedWallet.walletId;
    try {
      // Android Chrome requires the native handoff within the user's tap.
      // Validate the pre-warmed connection before leaving the browser; the
      // signing adapter checks it again once transaction preparation finishes.
      const cachedClient = getCachedWalletKit(network)?.client;
      const cachedSession =
        cachedClient &&
        approvedMobileSession(connectedWallet, cachedClient.session.values, network);
      const link = cachedSession && mobileWalletLink(cachedSession.walletId);
      if (link) window.open(link, "_self");
      const { client } = await getWalletKit(network);
      const session =
        client && approvedMobileSession(connectedWallet, client.session.values, network);
      if (!client || !session) {
        setConnectedWallet(null);
        setShowPicker(true);
        void beginPairing();
        toast.info("Your wallet connection ended. Connect again to continue.");
        return;
      }
      const { WalletNetwork } = await import("@creit.tech/stellar-wallets-kit");
      const expectedPassphrase =
        network === "mainnet" ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET;
      // Bypass the kit's account-based session search: the user chose this
      // exact connection, even if another stored topic has the same account.
      await submitTrigger(
        session.address,
        {
          getAddress: async () => ({ address: session.address }),
          signTransaction: async (xdr, opts) => {
            if (opts.networkPassphrase !== expectedPassphrase)
              throw new Error("Wallet and payment networks do not match.");
            if (
              !approvedMobileSession(session, client.session.values, network) ||
              opts.address !== session.address
            )
              throw new Error("Wallet connection ended. Connect again to continue.");
            const result: unknown = await client.request({
              topic: session.topic,
              chainId: stellarChainId(network),
              request: { method: "stellar_signXDR", params: { xdr } },
            });
            if (
              !result ||
              typeof result !== "object" ||
              !("signedXDR" in result) ||
              typeof result.signedXDR !== "string" ||
              !result.signedXDR
            )
              throw new Error("Wallet returned no signed transaction");
            return { signedTxXdr: result.signedXDR };
          },
        },
        () => setShowOpenWallet(true),
      );
    } catch (err) {
      trackTriggerFailure(err);
      toastError(err, "Payment failed");
    } finally {
      setBusy(false);
      setShowOpenWallet(false);
    }
  }

  async function onTrigger() {
    if (disabled || showPicker || pendingAllowanceHash) return;
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
      if (connectedWallet) {
        const { client } = await getWalletKit(network);
        const session = approvedMobileSession(
          connectedWallet,
          client?.session.values ?? [],
          network,
        );
        setConnectedWallet(session);
        if (session) return;
      }
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
                <p className="text-body-sm text-on-background/60 mt-2 px-4 text-center">
                  Approve the connection in your wallet, then return here to continue.
                </p>
              </div>
            )}
            <h3 className="text-label-lg text-on-background mb-1 text-center font-bold">
              {connectedWallet
                ? mode === "allowance"
                  ? "Confirm Approval"
                  : "Confirm Payment"
                : "Select Wallet"}
            </h3>
            <p className="text-body-sm text-on-background/60 mb-5 text-center">
              {connectedWallet ? "Review and sign in your wallet" : "Choose a wallet to connect"}
            </p>
            {connectedWallet ? (
              <div className="space-y-3">
                <button
                  onClick={() => void continueMobileSession()}
                  disabled={busy}
                  title={connectedWallet.address}
                  className="bg-primary text-on-primary w-full rounded-xl p-3 font-medium disabled:opacity-50"
                >
                  {mode === "allowance" ? "Approve" : "Send"} with{" "}
                  {connectedWallet.address.slice(0, 6)}…{connectedWallet.address.slice(-4)}
                </button>
                <button
                  onClick={() => {
                    setConnectedWallet(null);
                    void beginPairing();
                  }}
                  disabled={busy}
                  className="text-on-background w-full rounded-xl p-3 font-medium disabled:opacity-50"
                >
                  Reconnect wallet
                </button>
              </div>
            ) : (
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
            )}
            {!connectedWallet && pairingState !== "ready" && !busy && (
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
        disabled={disabled || busy || showPicker || Boolean(pendingAllowanceHash)}
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

      {isPublicAllowance && allowanceMessage && (
        <p role="status" className="text-label-sm text-on-background/80 mt-3 break-all">
          {allowanceMessage}
        </p>
      )}
      {isPublicAllowance && pendingAllowanceHash && (
        <button
          disabled={busy}
          className="text-primary mt-3 w-full rounded border p-3 disabled:opacity-50"
          onClick={() => {
            setBusy(true);
            void checkAllowanceStatus(pendingAllowanceHash).finally(() => setBusy(false));
          }}
        >
          CHECK APPROVAL STATUS
        </button>
      )}

      {isMobile() && showOpenWallet && selectedWalletRef.current && (
        <div>
          <button
            onClick={() => {
              const link = mobileWalletLink(selectedWalletRef.current!);
              if (link) window.open(link, "_self");
            }}
            className="border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20 mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-3 font-mono text-xs font-bold transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
            OPEN {selectedWalletRef.current.toUpperCase()} TO SIGN
          </button>
          <p role="status" className="text-body-sm text-on-background/60 mt-2 text-center">
            Approve in your wallet, then switch back to Chrome or your browser to see the result.
          </p>
        </div>
      )}
    </>
  );
}
