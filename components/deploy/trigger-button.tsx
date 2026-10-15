"use client";

import { useRef, useState, useEffect, useLayoutEffect } from "react";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-toast";
import { usePollTxStatus } from "@/lib/hooks/use-poll-tx-status";
import { apiError } from "@/lib/friendly-error";
import { trackWalletConnection } from "@/lib/wallet-tracking";
import { track } from "@/lib/analytics/client";
import { classifyError } from "@/lib/analytics/classify-error";
import {
  allowancePendingKey,
  readAllowancePendingHash,
} from "@/lib/subscription/allowance-pending";
import {
  CONTRACT_CALL_PENDING_EVENT,
  clearPendingContractCall,
  contractCallPendingKey,
  readPendingContractCall,
  savePendingContractCall,
  withContractCallLock,
} from "@/lib/contract-call-pending";
import { mobileWalletLink } from "./mobile-wallet-links";
import { mobilePickerWallets } from "./mobile-wallet-registry";
import { approvedMobileSession, type MobileWalletSession } from "./mobile-wallet-session";
import { connectSelectedWallet } from "./selected-wallet-connection";
import { walletConnectConnection, walletConnectIdentity } from "./wallet-connect-connection";
import { PENDING_WALLET_RETURN_KEY, pendingWalletReturn } from "./trigger-wallet-return";
import { getCachedWalletKit, getWalletKit, type WalletConnectClient } from "./wallet-kit";
import {
  isPairingFresh,
  PAIRING_STALE_MARGIN_MS,
  pairingExpiresAt,
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
type Attempt = {
  controller: AbortController;
  stage: "wallet" | "prepare" | "sign" | "submit" | "onchain" | "status_poll";
  startedAt: number;
  txHash?: string;
  dispatched: boolean;
  handoffStarted: boolean;
};
type AllowancePending = { txHash: string; intent: string };
type Pairing = {
  uri: string;
  approval: () => Promise<{ topic: string }>;
  expiresAt: number;
  network: "testnet" | "mainnet";
};
type Signer = {
  signTransaction: (
    xdr: string,
    options: { address: string; networkPassphrase: string },
  ) => Promise<{ signedTxXdr: string }>;
};
function isMobile() {
  return (
    typeof window !== "undefined" &&
    Boolean(
      window.matchMedia("(pointer:coarse)").matches ||
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|Opera Mini/u.test(navigator.userAgent),
    )
  );
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
  const [showPicker, setShowPicker] = useState(false);
  const [pendingWallet, setPendingWallet] = useState<string | null>(null);
  const [showOpenWallet, setShowOpenWallet] = useState(false);
  const [connectedWallet, setConnectedWallet] = useState<MobileWalletSession | null>(null);
  const [pairingState, setPairingState] = useState<"idle" | "preparing" | "ready" | "failed">(
    "idle",
  );
  const [pendingAllowance, setPendingAllowance] = useState<AllowancePending | null>(null);
  const pendingAllowanceHash = pendingAllowance?.txHash ?? null;
  const [allowanceMessage, setAllowanceMessage] = useState<string | null>(null);
  const [pendingHash, setPendingHash] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const activeAttemptRef = useRef<Attempt | null>(null);
  const selectedWalletRef = useRef<string | null>(null);
  const readyRef = useRef<Pairing | null>(null);
  const pairingInFlightRef = useRef<Promise<void> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prewarmEpochRef = useRef(0);
  const pollTxStatus = usePollTxStatus();
  const isPublicAllowance = mode === "allowance" && templateKind !== "PAYROLL";
  const allowanceStorageKey = allowancePendingKey(deploymentId, network);
  const pendingKey = contractCallPendingKey(deploymentId, network);
  const mobileSessionKey = `paiflow_mobile_wallet:${network}`;
  const boundAction = JSON.stringify([
    deploymentId,
    network,
    amount,
    mode,
    templateKind ?? null,
    !!isDeposit,
  ]);

  const isCurrent = (attempt: Attempt) =>
    activeAttemptRef.current === attempt && !attempt.controller.signal.aborted;
  const check = (attempt: Attempt) => {
    attempt.controller.signal.throwIfAborted();
    if (activeAttemptRef.current !== attempt) throw new Error("Wallet action ended.");
  };
  function createAttempt(startedAt = Date.now()): Attempt {
    const attempt: Attempt = {
      controller: new AbortController(),
      stage: "wallet",
      startedAt,
      dispatched: false,
      handoffStarted: false,
    };
    activeAttemptRef.current = attempt;
    return attempt;
  }
  function finish(attempt: Attempt) {
    if (activeAttemptRef.current !== attempt) return;
    activeAttemptRef.current = null;
    if (!attempt.controller.signal.aborted) {
      setBusy(false);
      setShowPicker(false);
      setPendingWallet(null);
      setShowOpenWallet(false);
    }
  }
  function fail(error: unknown, attempt: Attempt, fallback: string) {
    if (!isCurrent(attempt)) return;
    const classified = classifyError(error);
    track("trigger_failed", {
      deployment_id: deploymentId,
      stage: attempt.stage,
      error_class: classified.errorClass,
      error_code: classified.errorCode,
      ...(attempt.txHash ? { tx_hash: attempt.txHash } : {}),
    });
    toastError(error, fallback);
  }
  // This signal owns UI/preparation only. Dispatched hashes reconcile without it.
  useLayoutEffect(() => {
    setBusy(false);
    setShowPicker(false);
    setPendingWallet(null);
    setShowOpenWallet(false);
    return () => {
      activeAttemptRef.current?.controller.abort();
      activeAttemptRef.current = null;
    };
  }, [boundAction, disabled]);

  function readAllowance(): AllowancePending | null {
    const raw = localStorage.getItem(allowanceStorageKey);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      !("txHash" in value) ||
      typeof value.txHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.txHash) ||
      !("intent" in value) ||
      typeof value.intent !== "string" ||
      !value.intent
    )
      throw new Error("Stored approval status is invalid. Resolve it before approving again.");
    return { txHash: value.txHash, intent: value.intent };
  }
  function saveAllowance(saved: AllowancePending) {
    if (readAllowance()) throw new Error("Resolve the pending approval before approving again.");
    localStorage.setItem(allowanceStorageKey, JSON.stringify(saved));
    const actual = readAllowance();
    if (actual?.txHash !== saved.txHash || actual.intent !== saved.intent)
      throw new Error("Approval status could not be saved; no transaction was submitted.");
    window.dispatchEvent(new Event(CONTRACT_CALL_PENDING_EVENT));
  }
  function clearAllowance(hash: string) {
    if (readAllowance()?.txHash === hash) localStorage.removeItem(allowanceStorageKey);
    window.dispatchEvent(new Event(CONTRACT_CALL_PENDING_EVENT));
  }
  function loadPending() {
    try {
      const generic = readPendingContractCall(pendingKey);
      const allowance = isPublicAllowance ? readAllowance() : null;
      setPendingHash(generic?.txHash ?? null);
      setPendingAllowance(allowance);
      const otherAllowance = !isPublicAllowance && readAllowancePendingHash(deploymentId, network);
      setStorageBlocked(Boolean(otherAllowance));
      if (otherAllowance)
        setStatusMessage(
          `Approval ${otherAllowance} is unresolved. Check its status on the allowance page before starting another action.`,
        );
      if (!generic && !allowance && !otherAllowance) setStatusMessage(null);
      return { generic, allowance };
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
  function trackSuccess(attempt: Attempt, address: string) {
    if (!isCurrent(attempt) || !attempt.txHash) return;
    track("trigger_succeeded", {
      deployment_id: deploymentId,
      tx_hash: attempt.txHash,
      signer_address: address,
      elapsed_ms: Date.now() - attempt.startedAt,
    });
  }
  async function reconcileHash(
    hash: string,
    current: () => boolean,
    onConfirmed?: () => void,
    onFailed?: (error: Error) => void,
  ) {
    try {
      const outcome = await pollTxStatus(deploymentId, hash);
      if (outcome.status !== "SUCCESS" && outcome.status !== "FAILED")
        throw new Error("Transaction finality is unknown.");
      clearPendingContractCall(pendingKey, hash);
      if (current()) {
        setStatusMessage(null);
        if (outcome.status === "SUCCESS") {
          toast.success(
            mode === "allowance"
              ? "Allowance approved!"
              : isDeposit
                ? "Deposited!"
                : "Distribution triggered!",
          );
          onConfirmed?.();
        } else {
          const error = new Error(outcome.errorMessage ?? "Transaction failed on the network");
          if (onFailed) onFailed(error);
          else toastError(error, "Transaction failed");
        }
      }
    } catch {
      if (current())
        setStatusMessage(
          `Confirmation is still unknown for ${hash}. Check its status before starting another action.`,
        );
    }
  }
  async function reconcileAllowance(
    saved: AllowancePending,
    current: () => boolean,
    onConfirmed?: () => void,
  ) {
    if (current()) setAllowanceMessage(`Checking approval ${saved.txHash}`);
    try {
      const outcome = await pollTxStatus(
        deploymentId,
        saved.txHash,
        undefined,
        `/api/deployments/${deploymentId}/subscription-allowance/status?intent=${encodeURIComponent(saved.intent)}`,
      );
      if (outcome.status !== "SUCCESS" && outcome.status !== "FAILED")
        throw new Error("Approval finality is unknown.");
      clearAllowance(saved.txHash);
      if (current()) {
        if (outcome.status === "SUCCESS") {
          setAllowanceMessage(`Allowance confirmed: ${saved.txHash}`);
          toast.success("Allowance approved!");
          onConfirmed?.();
        } else
          setAllowanceMessage(
            `${outcome.errorMessage ?? "Approval failed on the network"}: ${saved.txHash}. You can try again.`,
          );
      }
    } catch {
      if (current())
        setAllowanceMessage(
          `Confirmation is still unknown for ${saved.txHash}. Check its status before approving again.`,
        );
    }
  }
  async function checkPendingStatus() {
    if (activeAttemptRef.current && !activeAttemptRef.current.controller.signal.aborted) return;
    const attempt = createAttempt();
    setBusy(true);
    try {
      await withContractCallLock(pendingKey, async () => {
        const generic = readPendingContractCall(pendingKey);
        const allowance = isPublicAllowance ? readAllowance() : null;
        if (allowance) await reconcileAllowance(allowance, () => isCurrent(attempt));
        if (generic) await reconcileHash(generic.txHash, () => isCurrent(attempt));
      });
    } catch {
      if (isCurrent(attempt))
        setStatusMessage(
          "Another tab may be checking this transaction. Its status remains unresolved.",
        );
    } finally {
      finish(attempt);
    }
  }
  useEffect(() => {
    setStorageReady(false);
    setStatusMessage(null);
    setAllowanceMessage(null);
    const refresh = () => {
      try {
        loadPending();
      } catch {
        /* Fail closed. */
      }
    };
    window.addEventListener("storage", refresh);
    window.addEventListener(CONTRACT_CALL_PENDING_EVENT, refresh);
    try {
      const saved = loadPending();
      if (saved.generic || saved.allowance) void checkPendingStatus();
    } catch {
      /* No signing without reliable recovery state. */
    }
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(CONTRACT_CALL_PENDING_EVENT, refresh);
    };
    // A remount only reconciles recorded hashes; never prepares or resubmits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey, isPublicAllowance]);

  async function withAttempt(attempt: Attempt, action: () => Promise<void>) {
    await withContractCallLock(pendingKey, async () => {
      let onAbort!: () => void;
      const cancelled = new Promise<never>((_resolve, reject) => {
        onAbort = () => {
          if (!attempt.dispatched) reject(new Error("Action cancelled before submission."));
        };
        attempt.controller.signal.addEventListener("abort", onAbort, { once: true });
        if (attempt.controller.signal.aborted) onAbort();
      });
      const execute = async () => {
        check(attempt);
        if (readPendingContractCall(pendingKey) || readAllowancePendingHash(deploymentId, network))
          throw new Error("Resolve the pending transaction before starting another action.");
        await action();
      };
      try {
        await Promise.race([execute(), cancelled]);
      } finally {
        attempt.controller.signal.removeEventListener("abort", onAbort);
      }
    });
  }
  async function submitTrigger(
    address: string,
    signer: Signer,
    attempt: Attempt,
    onAwaitingSignature?: () => void,
  ) {
    check(attempt);
    attempt.stage = "prepare";
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
    const prepared = await fetch(preparePath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount, userAddress: address }),
      signal: attempt.controller.signal,
    });
    const body: unknown = await prepared.json();
    check(attempt);
    if (!prepared.ok) throw apiError(body, "Failed to prepare transaction");
    const data = body && typeof body === "object" && "data" in body ? body.data : null;
    if (!data || typeof data !== "object")
      throw new Error("Invalid prepared transaction response.");
    const xdr = "xdr" in data ? data.xdr : "unsignedXdr" in data ? data.unsignedXdr : null;
    const passphrase = "networkPassphrase" in data ? data.networkPassphrase : null;
    if (typeof xdr !== "string" || !xdr || typeof passphrase !== "string")
      throw new Error("Invalid prepared transaction response.");
    try {
      localStorage.removeItem("WALLETCONNECT_DEEPLINK_CHOICE");
    } catch {
      /* No redirect hints are needed. */
    }
    const { assertWalletNetwork, signedWalletTransactionHash } =
      await import("@/lib/stellar/wallet-signature");
    check(attempt);
    assertWalletNetwork(network, passphrase);
    onAwaitingSignature?.();
    attempt.stage = "sign";
    toast.info("Awaiting signature...");
    const signed = await signer.signTransaction(xdr, { address, networkPassphrase: passphrase });
    check(attempt);
    const txHash = signedWalletTransactionHash(
      network,
      xdr,
      signed.signedTxXdr,
      address,
      passphrase,
    );
    attempt.txHash = txHash;
    attempt.stage = "submit";
    if (readPendingContractCall(pendingKey) || readAllowancePendingHash(deploymentId, network))
      throw new Error("Resolve the pending transaction before starting another action.");
    if (isPublicAllowance) {
      if (
        !("txHash" in data) ||
        data.txHash !== txHash ||
        !("intent" in data) ||
        typeof data.intent !== "string" ||
        !data.intent
      )
        throw new Error("Missing or mismatched allowance approval intent.");
      const saved = { txHash, intent: data.intent };
      try {
        saveAllowance(saved);
      } catch (error) {
        if (isCurrent(attempt)) {
          setStorageBlocked(true);
          setStatusMessage("Approval status could not be saved. No transaction was submitted.");
        }
        throw error;
      }
      attempt.dispatched = true;
      toast.info("Submitting transaction...");
      // This established protocol retains its scoped intent separately. A 4xx
      // response is a definite pre-send refusal; transport/5xx remains unknown.
      const sending = (async (): Promise<Error | null> => {
        try {
          const response = await fetch(submitPath, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ signedXdr: signed.signedTxXdr, intent: saved.intent }),
          });
          const result = await response.json();
          if (!response.ok && response.status >= 400 && response.status < 500) {
            clearAllowance(txHash);
            if (isCurrent(attempt)) setAllowanceMessage(null);
            return apiError(result, "Approval refused");
          }
        } catch {
          /* Transport/5xx never proves the bytes were not sent. */
        }
        return null;
      })();
      // Preserve immediate definite refusals without letting a lost POST hold
      // reconciliation forever. This timer starts reads; it never clears state.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const first = await Promise.race([
        sending.then((refusal) => ({ settled: true, refusal })),
        new Promise<{ settled: boolean; refusal: Error | null }>((resolve) => {
          timer = setTimeout(() => resolve({ settled: false, refusal: null }), 2000);
        }),
      ]);
      if (timer) clearTimeout(timer);
      if (first.refusal) throw first.refusal;
      attempt.stage = "status_poll";
      const reconciling = reconcileAllowance(
        saved,
        () => isCurrent(attempt),
        () => trackSuccess(attempt, address),
      );
      if (!first.settled) {
        const lateRefusal = await Promise.race([sending, reconciling.then(() => null)]);
        if (lateRefusal) throw lateRefusal;
      }
      await reconciling;
      return;
    }
    try {
      savePendingContractCall(pendingKey, { txHash });
    } catch (error) {
      if (isCurrent(attempt)) {
        setStorageBlocked(true);
        setStatusMessage("Transaction status could not be saved. No transaction was submitted.");
      }
      throw error;
    }
    attempt.dispatched = true;
    toast.info("Submitting transaction...");
    // Only public hash state survives this boundary. Neither UI cancellation,
    // response loss nor a different response hash can discard/replace it.
    try {
      void fetch(submitPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedXdr: signed.signedTxXdr }),
      }).catch(() => {});
    } catch {
      // Even a synchronous transport error cannot prove non-dispatch.
    }
    attempt.stage = "status_poll";
    await reconcileHash(
      txHash,
      () => isCurrent(attempt),
      () => trackSuccess(attempt, address),
      (error) => {
        attempt.stage = "onchain";
        fail(error, attempt, "Transaction failed");
      },
    );
  }
  function rememberMobileSession(session: MobileWalletSession, attempt: Attempt) {
    check(attempt);
    setConnectedWallet(session);
    try {
      localStorage.setItem(mobileSessionKey, JSON.stringify(session));
    } catch {
      /* Session reuse is optional. */
    }
  }
  function removeWalletReturn(raw: string) {
    try {
      if (sessionStorage.getItem(PENDING_WALLET_RETURN_KEY) === raw)
        sessionStorage.removeItem(PENDING_WALLET_RETURN_KEY);
    } catch {
      /* Financial recovery never depends on this pairing hint. */
    }
  }
  async function runDesktopFlow(attempt: Attempt) {
    await withAttempt(attempt, async () => {
      const shared = await getWalletKit(network);
      check(attempt);
      const connection = await connectSelectedWallet(shared, network, attempt.controller.signal);
      check(attempt);
      if (!connection) {
        toast.warning("Connection cancelled");
        return;
      }
      toast.success(
        `Connected: ${connection.address.slice(0, 6)}...${connection.address.slice(-4)}`,
      );
      void trackWalletConnection({
        address: connection.address,
        network,
        walletId: connection.walletId,
        surface: "trigger",
      });
      await submitTrigger(connection.address, connection, attempt);
    });
  }

  function schedulePairingRefresh(expiresAt: number, epoch: number) {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(
      () => {
        if (prewarmEpochRef.current === epoch) void beginPairing({ silent: true });
      },
      Math.max(expiresAt - PAIRING_STALE_MARGIN_MS - Date.now(), 1000),
    );
  }
  function beginPairing({ silent = false }: { silent?: boolean } = {}): Promise<void> {
    if (pairingInFlightRef.current) return pairingInFlightRef.current;
    const epoch = prewarmEpochRef.current;
    const current = () => prewarmEpochRef.current === epoch;
    let work!: Promise<void>;
    work = (async () => {
      if (!current()) return;
      readyRef.current = null;
      setPairingState("preparing");
      try {
        const { client, module, method } = await getWalletKit(network);
        if (!current()) return;
        if (!client || !module) throw new Error(WALLET_CONNECT_UNCONFIGURED);
        const { uri, approval } = await client.connect({
          requiredNamespaces: {
            stellar: { methods: [method], chains: [stellarChainId(network)], events: [] },
          },
        });
        if (!current()) return;
        if (!uri) throw new Error("WalletConnect returned no pairing URI");
        const expiresAt = pairingExpiresAt(uri);
        readyRef.current = { uri, approval, expiresAt, network };
        setPairingState("ready");
        schedulePairingRefresh(expiresAt, epoch);
      } catch (error) {
        if (current()) {
          setPairingState("failed");
          if (!silent) toastError(error, "Connection failed");
        }
      } finally {
        if (pairingInFlightRef.current === work) pairingInFlightRef.current = null;
      }
    })();
    pairingInFlightRef.current = work;
    return work;
  }
  useEffect(() => {
    const epoch = ++prewarmEpochRef.current;
    readyRef.current = null;
    pairingInFlightRef.current = null;
    setConnectedWallet(null);
    if (isMobile())
      void getWalletKit(network)
        .then(({ client }) => {
          if (prewarmEpochRef.current !== epoch) return;
          let remembered: MobileWalletSession | null = null;
          try {
            remembered =
              client &&
              approvedMobileSession(
                JSON.parse(localStorage.getItem(mobileSessionKey) ?? "null"),
                client.session.values,
                network,
              );
          } catch {
            /* Optional session storage. */
          }
          if (remembered) setConnectedWallet(remembered);
          else void beginPairing({ silent: true });
        })
        .catch(() => {
          if (prewarmEpochRef.current === epoch) void beginPairing({ silent: true });
        });
    return () => {
      prewarmEpochRef.current++;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
    // Pairings belong to the network, not changing amount/render callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  function openMobileWallet(walletId: string) {
    const attempt = activeAttemptRef.current;
    if (
      !attempt ||
      !isCurrent(attempt) ||
      busy ||
      attempt.handoffStarted ||
      !mobileWalletLink(walletId)
    )
      return;
    const pairing = readyRef.current;
    if (!pairing || pairing.network !== network || !isPairingFresh(pairing.expiresAt)) {
      void beginPairing();
      return;
    }
    try {
      if (readPendingContractCall(pendingKey) || readAllowancePendingHash(deploymentId, network))
        return;
    } catch {
      setStorageBlocked(true);
      return;
    }
    const pairingTopic = /^wc:([^@]+)@2\?/u.exec(pairing.uri)?.[1];
    if (!pairingTopic) {
      toast.error("Invalid wallet pairing URI");
      return;
    }
    const raw = JSON.stringify({
      boundAction,
      network,
      timestamp: attempt.startedAt,
      walletId,
      pairingTopic,
    });
    try {
      sessionStorage.setItem(PENDING_WALLET_RETURN_KEY, raw);
    } catch {
      /* Current-page pairing still works without reload recovery. */
    }
    // A native handoff consumes this approval. Even if it resolves after
    // cancellation, a later wallet choice must create its own fresh pairing.
    readyRef.current = null;
    setPairingState("idle");
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    attempt.handoffStarted = true;
    selectedWalletRef.current = walletId;
    setPendingWallet(walletId);
    setBusy(true);
    // Nothing awaited before native navigation: Android requires this tap.
    window.open(mobileWalletLink(walletId, pairing.uri)!, "_self", "noreferrer noopener");
    void completeMobileConnect(pairing, attempt, walletId, raw);
  }
  async function completeMobileConnect(
    pairing: Pairing,
    attempt: Attempt,
    walletId: string,
    raw: string,
  ) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await withAttempt(attempt, async () => {
        const { client } = await getWalletKit(network);
        check(attempt);
        if (!client) throw new Error(WALLET_CONNECT_UNCONFIGURED);
        const session = await Promise.race([
          pairing.approval(),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error("Wallet connection timed out")), 60000);
          }),
        ]);
        check(attempt);
        const approved = walletConnectIdentity(client, network, session.topic);
        const connection = walletConnectConnection(
          client,
          network,
          approved,
          attempt.controller.signal,
        );
        readyRef.current = null;
        setPairingState("idle");
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        removeWalletReturn(raw);
        rememberMobileSession({ ...approved, walletId }, attempt);
        setShowPicker(false);
        void trackWalletConnection({
          address: approved.address,
          network,
          walletId,
          surface: "trigger",
        });
        await submitTrigger(approved.address, connection, attempt, () => setShowOpenWallet(true));
      });
    } catch (error) {
      fail(error, attempt, "Connection failed");
      removeWalletReturn(raw);
    } finally {
      if (timeout) clearTimeout(timeout);
      finish(attempt);
    }
  }
  async function continueMobileSession() {
    const attempt = activeAttemptRef.current;
    if (!attempt || !isCurrent(attempt) || !connectedWallet || busy || attempt.handoffStarted)
      return;
    attempt.handoffStarted = true;
    setBusy(true);
    setShowPicker(false);
    selectedWalletRef.current = connectedWallet.walletId;
    let reconnect = false;
    try {
      if (readPendingContractCall(pendingKey) || readAllowancePendingHash(deploymentId, network))
        throw new Error("Resolve the pending transaction before starting another action.");
      const cached = getCachedWalletKit(network)?.client;
      const approved =
        cached && approvedMobileSession(connectedWallet, cached.session.values, network);
      const link = approved && mobileWalletLink(approved.walletId);
      if (link) window.open(link, "_self");
      await withAttempt(attempt, async () => {
        const { client } = await getWalletKit(network);
        check(attempt);
        const session =
          client && approvedMobileSession(connectedWallet, client.session.values, network);
        if (!client || !session) {
          setConnectedWallet(null);
          setShowPicker(true);
          void beginPairing();
          reconnect = true;
          toast.info("Your wallet connection ended. Connect again to continue.");
          return;
        }
        const connection = walletConnectConnection(
          client,
          network,
          session,
          attempt.controller.signal,
        );
        await submitTrigger(session.address, connection, attempt, () => setShowOpenWallet(true));
      });
    } catch (error) {
      fail(error, attempt, "Payment failed");
    } finally {
      if (reconnect && isCurrent(attempt)) {
        attempt.handoffStarted = false;
        setBusy(false);
        setShowOpenWallet(false);
      } else finish(attempt);
    }
  }
  useEffect(() => {
    if (disabled) return;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(PENDING_WALLET_RETURN_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      removeWalletReturn(raw);
      return;
    }
    const saved = pendingWalletReturn(data, boundAction, network);
    if (!saved) {
      removeWalletReturn(raw);
      toast.info("Reconnect your wallet to confirm this action.");
      return;
    }
    try {
      if (readPendingContractCall(pendingKey) || readAllowancePendingHash(deploymentId, network))
        return;
    } catch {
      return;
    }
    if (activeAttemptRef.current) return;
    const attempt = createAttempt(saved.timestamp);
    selectedWalletRef.current = saved.walletId;
    setBusy(true);
    const capturedRaw = raw;
    void (async () => {
      try {
        await withAttempt(attempt, async () => {
          const { client } = await getWalletKit(network);
          check(attempt);
          if (!client) throw new Error(WALLET_CONNECT_UNCONFIGURED);
          const sessions = client.session.values.filter(
            (session) => session.pairingTopic === saved.pairingTopic,
          );
          if (sessions.length !== 1)
            throw new Error(
              "No unique approved session found after returning from wallet. Reconnect to continue.",
            );
          const approved = walletConnectIdentity(client, network, sessions[0]!.topic);
          const connection = walletConnectConnection(
            client,
            network,
            approved,
            attempt.controller.signal,
          );
          rememberMobileSession({ ...approved, walletId: saved.walletId }, attempt);
          removeWalletReturn(capturedRaw);
          await submitTrigger(approved.address, connection, attempt, () => setShowOpenWallet(true));
        });
      } catch (error) {
        removeWalletReturn(capturedRaw);
        fail(error, attempt, "Connection failed");
      } finally {
        finish(attempt);
      }
    })();
    // Resume only a fresh pairing bound to this exact visible action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundAction, disabled]);
  async function onTrigger() {
    if (
      disabled ||
      showPicker ||
      !storageReady ||
      storageBlocked ||
      pendingHash ||
      pendingAllowanceHash ||
      activeAttemptRef.current
    )
      return;
    if (!amount || !/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
      toast.error("Enter a valid amount");
      return;
    }
    const attempt = createAttempt();
    setShowOpenWallet(false);
    track("trigger_started", { deployment_id: deploymentId, mode, amount_stroops: amount });
    if (isMobile()) {
      setShowPicker(true);
      if (connectedWallet) return;
      if (readyRef.current?.network === network && isPairingFresh(readyRef.current.expiresAt))
        setPairingState("ready");
      else void beginPairing();
    } else {
      setBusy(true);
      try {
        await runDesktopFlow(attempt);
      } catch (error) {
        fail(error, attempt, isDeposit ? "Deposit failed" : "Trigger failed");
      } finally {
        finish(attempt);
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
                {mobilePickerWallets().map((wallet) => (
                  <button
                    key={wallet.id}
                    onClick={() => openMobileWallet(wallet.id)}
                    disabled={busy || pairingState !== "ready"}
                    className="bg-background-2 hover:bg-background-3 disabled:hover:bg-background-2 flex w-full items-center gap-3 rounded-xl p-3 transition-colors disabled:opacity-50"
                  >
                    <img src={wallet.icon} alt="" className="h-10 w-10 rounded-lg" />
                    <span className="text-label-sm text-on-background font-medium">
                      {wallet.name}
                    </span>
                  </button>
                ))}
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
                activeAttemptRef.current?.controller.abort();
                activeAttemptRef.current = null;
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
        disabled={
          disabled ||
          busy ||
          showPicker ||
          !storageReady ||
          storageBlocked ||
          Boolean(pendingHash) ||
          Boolean(pendingAllowanceHash)
        }
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

      {statusMessage && (
        <p role="status" className="text-label-sm text-on-background/80 mt-3 break-all">
          {statusMessage}
        </p>
      )}
      {pendingHash && (
        <button
          disabled={busy}
          className="text-primary mt-3 w-full rounded border p-3 disabled:opacity-50"
          onClick={() => void checkPendingStatus()}
        >
          CHECK TRANSACTION STATUS
        </button>
      )}

      {isPublicAllowance && allowanceMessage && (
        <p role="status" className="text-label-sm text-on-background/80 mt-3 break-all">
          {allowanceMessage}
        </p>
      )}
      {isPublicAllowance && pendingAllowanceHash && (
        <button
          disabled={busy}
          className="text-primary mt-3 w-full rounded border p-3 disabled:opacity-50"
          onClick={() => void checkPendingStatus()}
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
