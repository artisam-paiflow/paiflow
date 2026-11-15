"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ExecutionDiscoverySchema } from "@/lib/api/v1/execution-schema";

import { withContractCallLock } from "@/lib/contract-call-pending";
import { formatStroops } from "@/lib/utils";
import type { NodeFieldPolicy } from "@/lib/flows/field-policies";
import { signWithRecovery } from "@/lib/wallet-signing-recovery";
import { signedWalletTransactionHash } from "@/lib/stellar/wallet-signature";
import {
  fieldKey,
  hostedRecoveryStorageKey,
  tokenInput,
  type AdditionalDraft,
} from "@/lib/hosted-execution/form";
import {
  hostedUiProtocol,
  readHostedUiRecovery,
  saveHostedUiRecovery,
  clearHostedUiRecovery,
  restoredHostedUiInputs,
  conditionalHostedState,
  conditionalHostedPrepared,
  type HostedUiRecovery as HostedBrowserRecovery,
  type HostedUiState as HostedState,
  type HostedUiPrepared as HostedPrepared,
} from "./hosted-payment-protocol";
import {
  conditionalHostedRequirements,
  conditionalHostedTermsIdentity,
} from "@/lib/hosted-execution/conditional-form";
import ConditionalHostedPaymentReview from "./conditional-hosted-payment-review";
import { getWalletKit } from "./wallet-kit";
import { connectSelectedWallet } from "./selected-wallet-connection";

type Connection = NonNullable<Awaited<ReturnType<typeof connectSelectedWallet>>>;
async function paymentRequest(path: string, body?: unknown) {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok) {
    const fields =
      result.error?.fields && typeof result.error.fields === "object"
        ? Object.entries(result.error.fields)
            .map(
              ([field, messages]) =>
                `${field}: ${Array.isArray(messages) ? messages.join(", ") : "Invalid input"}`,
            )
            .join("; ")
        : "";
    const error = new Error(
      [result.error?.message ?? "Payment request failed", fields].filter(Boolean).join(". "),
    );
    if (result.error?.code === "VALIDATION" && result.error?.fields?.ownershipProofXdr)
      Object.assign(error, { ownershipRequired: true });
    throw error;
  }
  return result.data as unknown;
}
function randomRecoveryKey() {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export default function HostedPaymentForm({
  deploymentId,
  flowName,
  network,
  enabled,
  conditional = false,
}: {
  deploymentId: string;
  flowName: string;
  network: "testnet" | "mainnet";
  enabled: boolean;
  conditional?: boolean;
}) {
  const protocol = hostedUiProtocol(conditional, deploymentId, network);
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const [currentError, setCurrentError] = useState(false);
  const currentReadSequence = useRef(0);
  const selection = useRef<{ key: string; prefix: Map<string, string> } | null>(null);
  const [state, setState] = useState<HostedState | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [rosters, setRosters] = useState<Record<string, AdditionalDraft[]>>({});
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState<string | null>(null);
  const connection = useRef<Connection | null>(null);
  const [prepared, setPrepared] = useState<HostedPrepared | null>(null);
  const [pending, setPending] = useState<HostedBrowserRecovery | null>(null);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const storageKey = hostedRecoveryStorageKey(deploymentId, network);
  const lockKey = `paiflow_contract_call_pending:${deploymentId}:${network}`;
  const base = `/api/deployments/${deploymentId}/hosted-execution`;

  const readHostedRecovery = (key: string) => readHostedUiRecovery(key, protocol);
  async function loadCurrent() {
    const sequence = ++currentReadSequence.current;
    try {
      const current = protocol.parseState(await paymentRequest(protocol.url(base, "state")));
      if (conditional && sequence !== currentReadSequence.current)
        throw new Error(
          "A newer current-term read superseded this observation. Retry the retained original.",
        );
      setState(current);
      setCurrentError(false);
      return current;
    } catch (error) {
      if (conditional && sequence === currentReadSequence.current) {
        setState(null);
        setCurrentError(true);
      }
      throw error;
    }
  }
  useEffect(() => {
    let active = true;
    const read = () => {
      try {
        const saved = readHostedRecovery(storageKey);
        setPending(saved);
        if (saved) {
          const restored = restoredHostedUiInputs(saved);
          setAmount(restored.amount);
          setFields(restored.fields);
          setRosters(restored.rosters);
        }
        setReady(true);
      } catch {
        setBlocked(true);
        setError(
          "Payment recovery storage is unavailable or invalid. Resolve it before making another payment.",
        );
      }
    };
    read();
    const changed = (event: StorageEvent) => {
      if (event.key === storageKey) {
        read();
        setPrepared(null);
        setAcknowledged(null);
      }
    };
    window.addEventListener("storage", changed);
    const sequence = conditional ? ++currentReadSequence.current : 0;
    if (enabled)
      void paymentRequest(protocol.url(base, "state"))
        .then((data) => {
          if (!conditional) {
            const current = ExecutionDiscoverySchema.parse(data);
            if (active && current.supported) setState(current);
          } else if (active && sequence === currentReadSequence.current) {
            setState(protocol.parseState(data));
            setCurrentError(false);
          }
        })
        .catch((err) => {
          if (active && (!conditional || sequence === currentReadSequence.current)) {
            if (conditional) {
              setState(null);
              setCurrentError(true);
            }
            setError(err instanceof Error ? err.message : "Payment form unavailable");
          }
        });
    return () => {
      active = false;
      controller.current?.abort();
      window.removeEventListener("storage", changed);
    };
  }, [base, enabled, storageKey, conditional]);

  useEffect(() => {
    if (!conditional || !state || !conditionalHostedState(state)) return;
    let branch = "invalid";
    try {
      branch = conditionalHostedRequirements(state, tokenInput(amount)).branch;
    } catch {
      /* Invalid amount has no active branch. */
    }
    const key = `${conditionalHostedTermsIdentity(state)}:${branch}`;
    const prefix = new Map(
      state.definition.prefix.map((node) => [
        node.nodeId,
        JSON.stringify({
          policy: node.policy,
          contractAddress: state.nodes.find((binding) => binding.nodeId === node.nodeId)
            ?.contractAddress,
        }),
      ]),
    );
    const previous = selection.current;
    if (previous?.key === key) return;
    try {
      if (readHostedRecovery(storageKey)) return;
    } catch {
      setBlocked(true);
      return;
    }
    selection.current = { key, prefix };
    setPrepared(null);
    setAcknowledged(null);
    setFields((old) =>
      Object.fromEntries(
        Object.entries(old).filter(([field]) =>
          [...prefix].some(
            ([nodeId, identity]) =>
              field.startsWith(`${nodeId}:`) && previous?.prefix.get(nodeId) === identity,
          ),
        ),
      ),
    );
    setRosters({});
  }, [conditional, state, amount, storageKey, pending]);
  useEffect(() => {
    if (!conditional || !enabled) return;
    let active = true;
    const timer = setInterval(() => {
      if (active && !busy) void loadCurrent().catch(() => {});
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [conditional, enabled, base, busy]);
  let knownStale = false;
  if (conditional && prepared) {
    try {
      if (!state) throw new Error();
      protocol.assertCurrentPrepared(state, prepared);
    } catch {
      knownStale = true;
    }
  }
  function save(record: HostedBrowserRecovery, previous?: HostedBrowserRecovery | null) {
    saveHostedUiRecovery(storageKey, record, protocol, previous);
    setPending(record);
  }
  async function action(run: () => Promise<void>) {
    if (busy || blocked || !ready) return;
    setBusy(true);
    setError(null);
    try {
      await withContractCallLock(lockKey, run);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment could not continue");
    } finally {
      setBusy(false);
    }
  }
  function activeConnection() {
    const current = connection.current;
    if (!current || controller.current?.signal.aborted)
      throw new Error("Connect your wallet again to continue");
    return current;
  }
  async function connect() {
    await action(async () => {
      controller.current?.abort();
      controller.current = new AbortController();
      const selected = await connectSelectedWallet(
        await getWalletKit(network),
        network,
        controller.current.signal,
      );
      if (selected) {
        connection.current = selected;
        setAddress(selected.address);
      }
    });
  }
  async function prepare(resume = false) {
    await action(async () => {
      const previous = readHostedRecovery(storageKey);
      if (!enabled || (!state && !(conditional && previous?.intent && previous.txHash)))
        throw new Error("Payment form is unavailable");
      if (previous && previous.phase !== "ownership" && previous.phase !== "preparing" && !resume)
        throw new Error("Check the previous payment before preparing another");
      if (previous?.phase === "signing" || previous?.phase === "submitted")
        throw new Error(
          "Signing or finality is unresolved. Check the original payment without signing again.",
        );
      const selected = activeConnection();
      const payment = previous
        ? previous.request
        : protocol.buildPayment(state!, selected.address, amount, fields, rosters);
      if (payment.from !== selected.address)
        throw new Error("Connect the original payer wallet to recover this preparation");
      if (conditional && !(previous?.intent && previous.txHash))
        protocol.assertCurrentPayment(await loadCurrent(), payment);
      else if (!conditional) protocol.assertCurrentPayment(state!, payment);
      const ownershipOnly = !previous || previous.phase === "ownership";
      const record = protocol.parseRecord({
        ...(conditional
          ? { version: 2, deploymentId: state?.deploymentId ?? deploymentId, network }
          : {}),
        ...previous,
        recoveryKey: previous?.recoveryKey ?? randomRecoveryKey(),
        request: payment,
        phase: ownershipOnly ? "ownership" : "preparing",
      });
      let durable = record;
      const persist = (next: HostedBrowserRecovery) => {
        save(next, durable);
        durable = next;
      };
      // Save the capability before a request can succeed with a lost HTTP acknowledgement.
      save(record, previous);
      setPrepared(null);
      setAcknowledged(null);
      const request = { recoveryKey: record.recoveryKey, payment };
      let response: unknown;
      const prepareWithProof = async () => {
        // A fresh/ownership-only record has never dispatched a signed proof.
        // A missing server row cannot establish this for a restored preparing record:
        // its original request may still be simulating and commit later.
        const challenge = await protocol.assertOwnership(
          await paymentRequest(protocol.url(base, "ownership"), request),
          payment,
          record.recoveryKey,
          selected.address,
          state?.deploymentId ?? deploymentId,
        );
        setMessage(
          ownershipOnly
            ? "Verify wallet ownership in your wallet. This sign-only proof cannot move funds. You will review and sign the payment separately."
            : "Verify ownership to recover this same preparation. Your inputs stay unchanged. This sign-only proof cannot move funds; payment review and signing remain separate.",
        );
        controller.current?.signal.throwIfAborted();
        if (connection.current !== selected) throw new Error("Wallet connection changed");
        const proof = await selected.signTransaction(challenge.xdr, {
          address: selected.address,
          networkPassphrase: challenge.networkPassphrase,
        });
        controller.current?.signal.throwIfAborted();
        if (connection.current !== selected) throw new Error("Wallet connection changed");
        if (!proof.signedTxXdr) throw new Error("Wallet ownership signature was not returned");
        signedWalletTransactionHash(
          network,
          challenge.xdr,
          proof.signedTxXdr,
          selected.address,
          challenge.networkPassphrase,
        );
        if (conditional) {
          protocol.assertCurrentPayment(await loadCurrent(), payment);
          controller.current?.signal.throwIfAborted();
          if (connection.current !== selected) throw new Error("Wallet connection changed");
        }
        // Persist uncertainty before the first request that can reserve the payer.
        persist(protocol.parseRecord({ ...record, phase: "preparing" }));
        // The proof stays in memory and is never sent to a transaction submission route.
        return paymentRequest(protocol.url(base, "prepare"), {
          ...request,
          ownershipProofXdr: proof.signedTxXdr,
        });
      };
      if (ownershipOnly) {
        response = await prepareWithProof();
      } else {
        try {
          // Recover only the original exact preparation. Missing rows never allow
          // editing, clearing its capability, or creating another payment identity.
          response = await paymentRequest(protocol.url(base, "prepare"), request);
        } catch (err) {
          if (!(err instanceof Error) || !("ownershipRequired" in err)) throw err;
          if (previous?.phase !== "preparing" || previous.intent || previous.txHash)
            throw new Error(
              "Keep the original payment receipt and check its status; no replacement preparation is allowed.",
            );
          // An earlier simulation may have failed before admission, or may still
          // commit. A new sign-only proof for the SAME immutable request/key is
          // safe in either case: server admission serializes that identity into
          // one intent. PREPARING remains non-editable throughout this retry.
          response = await prepareWithProof();
        }
      }
      const result = protocol.parsePrepared(response);
      protocol.assertPrepared(result, record);
      persist(
        protocol.parseRecord({
          ...record,
          phase: "prepared",
          intent: result.prepared.intent,
          txHash: result.prepared.txHash,
        }),
      );
      setPrepared(result);
      setMessage(null);
    });
  }
  async function sign() {
    await action(async () => {
      if (!prepared) throw new Error("Prepare and review this payment first");
      if (conditional && (!enabled || acknowledged !== prepared.prepared.txHash))
        throw new Error("Review and acknowledge this exact original payment first.");
      if (conditional) protocol.assertCurrentPrepared(await loadCurrent(), prepared);
      if (Date.parse(prepared.prepared.expiresAt) <= Date.now())
        throw new Error("This preparation has expired. Check its receipt before preparing again.");
      const saved = readHostedRecovery(storageKey);
      const selected = activeConnection();
      if (
        !saved ||
        saved.phase !== "prepared" ||
        !protocol.sameId(saved.intent ?? "", prepared.prepared.intent) ||
        saved.txHash !== prepared.prepared.txHash ||
        selected.address !== prepared.prepared.walletAddress
      )
        throw new Error(
          "The reviewed payment or wallet changed. Check its receipt before continuing.",
        );
      if (conditional) protocol.assertPrepared(prepared, saved);
      const check = () => {
        controller.current?.signal.throwIfAborted();
        if (connection.current !== selected) throw new Error("Wallet connection changed");
      };
      const { signedTxXdr, attempt } = await signWithRecovery({
        network,
        address: selected.address,
        xdr: prepared.prepared.xdr,
        networkPassphrase: prepared.prepared.networkPassphrase,
        check,
        save: (attempt) => save(protocol.parseRecord({ ...saved, ...attempt }), saved),
        read: () => {
          const record = readHostedRecovery(storageKey);
          return record?.txHash && (record.phase === "signing" || record.phase === "submitted")
            ? { txHash: record.txHash, phase: record.phase, attemptId: record.attemptId }
            : null;
        },
        clearRejected: () => {
          const actual = readHostedRecovery(storageKey);
          if (!actual) throw new Error("Original signing recovery is missing.");
          save(protocol.parseRecord({ ...saved, phase: "prepared" }), actual);
        },
        sign: () =>
          selected.signTransaction(prepared.prepared.xdr, {
            address: selected.address,
            networkPassphrase: prepared.prepared.networkPassphrase,
          }),
      });
      check();
      const current = readHostedRecovery(storageKey);
      if (current?.attemptId !== attempt.attemptId || current.phase !== "signing")
        throw new Error("Signing attempt changed; check the original payment");
      save(protocol.parseRecord({ ...current, phase: "submitted" }), current);
      setPrepared(null);
      // Signed bytes remain in memory only and are never saved to browser storage.
      const submitted = await paymentRequest(protocol.url(base, "submit"), {
        recoveryKey: saved.recoveryKey,
        intent: saved.intent,
        signedXdr: signedTxXdr,
      });
      protocol.parseSubmitted(submitted, prepared.prepared.txHash);
      setMessage("Payment submitted. Check its status before making another payment.");
    });
  }
  async function reconcile() {
    await action(async () => {
      const saved = readHostedRecovery(storageKey);
      if (!saved) throw new Error("No payment receipt is stored in this browser");
      const result = protocol.parseReceipt(
        await paymentRequest(protocol.url(base, "receipt"), { recoveryKey: saved.recoveryKey }),
      );
      if (
        result.network !== network ||
        (saved.intent && !protocol.sameId(result.intent, saved.intent)) ||
        (saved.txHash && result.txHash !== saved.txHash)
      )
        throw new Error("Receipt does not match this payment");
      if (["SUCCESS", "FAILED", "EXPIRED"].includes(result.state)) {
        if (conditional || readHostedRecovery(storageKey)?.recoveryKey === saved.recoveryKey)
          clearHostedUiRecovery(storageKey, saved, protocol);
        setPending(null);
        setPrepared(null);
        setMessage(
          result.state === "SUCCESS"
            ? `Payment confirmed: ${result.txHash}`
            : result.state === "FAILED"
              ? `Payment failed on chain: ${result.txHash}`
              : `Original transaction expired with verified finality: ${result.txHash}. You can prepare again.`,
        );
        if (result.state === "SUCCESS") toast.success("Payment confirmed");
      } else {
        save(
          protocol.parseRecord({ ...saved, intent: result.intent, txHash: result.txHash }),
          saved,
        );
        setMessage(
          result.state === "PREPARED"
            ? "Original payment is prepared. If signing was interrupted, keep checking this receipt; do not sign a replacement. Expiry alone does not establish failure."
            : "Payment finality is still unknown. Keep checking the original receipt; do not pay again.",
        );
      }
    });
  }

  function input(
    label: string,
    value: string,
    onChange: (value: string) => void,
    mode: "text" | "decimal" = "text",
  ) {
    return (
      <label className="block space-y-1 text-sm">
        {label}
        <input
          className="input w-full"
          value={value}
          inputMode={mode}
          required
          disabled={busy || Boolean(pending) || (conditional && blocked)}
          onChange={(event) => {
            setPrepared(null);
            onChange(event.target.value);
          }}
        />
      </label>
    );
  }
  function runtimeFields() {
    let policies: NodeFieldPolicy[];
    try {
      policies = state ? protocol.policies(state, amount) : [];
    } catch {
      policies = [];
    }
    return policies.map((policy) => (
      <fieldset
        className={`border-outline-variant space-y-3 rounded border p-3 ${conditional ? "min-w-0 break-words" : ""}`}
        key={policy.nodeId}
      >
        <legend className="px-1 font-mono text-sm">
          {policy.kind === "pay" ? "Pay" : "Split"} · {policy.nodeId}
        </legend>
        {policy.kind === "pay" ? (
          policy.recipient === "execution" &&
          input(
            "Payment recipient",
            fields[fieldKey(policy.nodeId, "pay", "recipient")] ?? "",
            (value) =>
              setFields((old) => ({
                ...old,
                [fieldKey(policy.nodeId, "pay", "recipient")]: value,
              })),
          )
        ) : (
          <>
            {policy.rows.map((row) => (
              <div className="space-y-2" key={row.rowId}>
                <p className="text-sm">Configured destination {row.rowId}</p>
                {row.recipient === "execution" &&
                  input(
                    `Recipient for ${row.rowId}`,
                    fields[fieldKey(policy.nodeId, row.rowId, "recipient")] ?? "",
                    (value) =>
                      setFields((old) => ({
                        ...old,
                        [fieldKey(policy.nodeId, row.rowId, "recipient")]: value,
                      })),
                  )}
                {row.allocation === "execution" &&
                  input(
                    `${policy.allocationMode === "fixed" ? "Amount" : "Percentage"} for ${row.rowId}`,
                    fields[fieldKey(policy.nodeId, row.rowId, "allocation")] ?? "",
                    (value) =>
                      setFields((old) => ({
                        ...old,
                        [fieldKey(policy.nodeId, row.rowId, "allocation")]: value,
                      })),
                    "decimal",
                  )}
                {row.recipient === "constant" && row.allocation === "constant" && (
                  <p className="text-on-surface-variant text-sm">
                    Recipient and allocation are fixed by the owner.
                  </p>
                )}
              </div>
            ))}
            {policy.additionalRecipients === "execution" && (
              <div className="space-y-3">
                <p className="text-sm">
                  Additional destinations ·{" "}
                  {policy.allocationMode === "percentage"
                    ? "all shares, including fixed shares, must total 100%"
                    : "all allocations must exactly match funds entering this Split"}
                </p>
                {(rosters[policy.nodeId] ?? []).map((row, index) => (
                  <div className="space-y-2" key={row.rowId}>
                    {input(`Additional recipient ${index + 1}`, row.recipient, (value) =>
                      setRosters((old) => ({
                        ...old,
                        [policy.nodeId]: (old[policy.nodeId] ?? []).map((item) =>
                          item.rowId === row.rowId ? { ...item, recipient: value } : item,
                        ),
                      })),
                    )}
                    {input(
                      `${policy.allocationMode === "fixed" ? "Amount" : "Percentage"} for additional recipient ${index + 1}`,
                      row.allocation,
                      (value) =>
                        setRosters((old) => ({
                          ...old,
                          [policy.nodeId]: (old[policy.nodeId] ?? []).map((item) =>
                            item.rowId === row.rowId ? { ...item, allocation: value } : item,
                          ),
                        })),
                      "decimal",
                    )}
                    <button
                      type="button"
                      className="text-error text-sm underline"
                      disabled={busy || Boolean(pending) || (conditional && blocked)}
                      onClick={() =>
                        setRosters((old) => ({
                          ...old,
                          [policy.nodeId]: (old[policy.nodeId] ?? []).filter(
                            (item) => item.rowId !== row.rowId,
                          ),
                        }))
                      }
                    >
                      Remove recipient {index + 1}
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={
                    busy ||
                    Boolean(pending) ||
                    policy.rows.length + (rosters[policy.nodeId]?.length ?? 0) >= 20
                  }
                  onClick={() =>
                    setRosters((old) => ({
                      ...old,
                      [policy.nodeId]: [
                        ...(old[policy.nodeId] ?? []),
                        { rowId: `input-${crypto.randomUUID()}`, recipient: "", allocation: "" },
                      ],
                    }))
                  }
                >
                  Add destination
                </button>
              </div>
            )}
          </>
        )}
      </fieldset>
    ));
  }

  return (
    <main className="bg-surface text-on-surface p-md min-h-screen">
      <div className="mx-auto max-w-xl space-y-5 py-8">
        <span data-testid="network-chip" className="text-primary font-mono">
          {network.toUpperCase()}
        </span>
        <h1 className="font-display text-3xl">{flowName}</h1>
        {conditional && enabled && (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || blocked}
            onClick={() =>
              action(async () => {
                await loadCurrent();
              })
            }
          >
            Refresh payment terms
          </button>
        )}
        {!enabled && (
          <p>This payment form is unavailable. A previously stored receipt can still be checked.</p>
        )}
        {enabled && state && !(conditional && pending) && (
          <section className="glass-panel space-y-4 rounded-xl p-4" aria-label="Payment inputs">
            <p className="text-sm">
              Pay with your wallet. No Paiflow account is required. Fixed destinations and
              allocations cannot be changed.
            </p>
            <p className="text-sm">
              Preparing a new payment first asks for a sign-only wallet ownership proof. It cannot
              move funds. You review and sign the payment in a separate step.
            </p>
            <p className="text-on-surface-variant text-xs break-all">
              Asset contract: {protocol.asset(state)}
            </p>
            {input("Payment amount", amount, setAmount, "decimal")}
            {conditional && state && conditionalHostedState(state) && (
              <p className="text-sm">
                Threshold: {state.definition.condition.thresholdStroops} stroops (
                {state.definition.condition.thresholdMode}); compare after upstream Pay deductions,
                equality takes False. Only the selected branch asks for payment inputs.
              </p>
            )}
            {runtimeFields()}
            {address && <p className="text-sm break-all">Payer: {address}</p>}
            <button
              type="button"
              className="btn-secondary"
              disabled={
                busy ||
                !ready ||
                blocked ||
                Boolean(pending?.phase === "signing" || pending?.phase === "submitted")
              }
              onClick={connect}
            >
              {address ? "Reconnect wallet" : "Connect wallet"}
            </button>
            <button
              type="button"
              className="btn-primary ml-3"
              disabled={
                busy ||
                !address ||
                !ready ||
                blocked ||
                Boolean(pending && pending.phase !== "ownership" && pending.phase !== "preparing")
              }
              onClick={() => prepare()}
            >
              {busy ? "Working…" : "Prepare payment"}
            </button>
          </section>
        )}
        {prepared && (
          <section
            className={`glass-panel space-y-3 rounded-xl p-4 ${conditional ? "break-words" : ""}`}
            aria-label="Review payment"
          >
            <h2 className="text-xl">Review before signing</h2>
            <p>
              Deposit: {formatStroops(prepared.prepared.execution.amountStroops)} · Maximum
              transaction fee: {formatStroops(prepared.feeStroops)} XLM
            </p>
            <p className="text-sm break-all">Payer: {prepared.prepared.walletAddress}</p>
            {prepared.rows.map((row) => (
              <div
                key={`${row.nodeId}:${row.rowId}`}
                className="border-outline-variant rounded border p-3 text-sm"
              >
                {"kind" in row && row.kind === "return_to_owner" && (
                  <p className="font-medium">Return to immutable deployment owner</p>
                )}
                <p className="break-all">{row.recipient}</p>
                <p>
                  {formatStroops(row.amountStroops)} · {row.allocation}
                </p>
                <p>
                  Recipient:{" "}
                  {row.recipientSource === "constant"
                    ? "fixed"
                    : row.recipientSource === "execution"
                      ? "your input"
                      : "stored; admin may update"}
                  ; allocation:{" "}
                  {row.allocationSource === "constant"
                    ? "fixed"
                    : row.allocationSource === "execution"
                      ? "your input"
                      : "stored; admin may update"}
                  .
                </p>
              </div>
            ))}
            {prepared.accumulation && (
              <p>
                A fixed Split accumulates deposits until its configured batch is funded. Listed
                amounts are batch allocations, not a promise that this deposit alone pays the batch.
              </p>
            )}
            {prepared.refundStroops !== "0" && (
              <p>Unused amount returned to your wallet: {formatStroops(prepared.refundStroops)}.</p>
            )}
            <p className="text-sm">
              Reviewed revisions:{" "}
              {prepared.prepared.execution.nodes
                .map((node) => `${node.nodeId}=${node.expectedRevision}`)
                .join(", ")}
              . Changed configuration fails on chain and needs a new preparation.
            </p>
            <p className="text-sm">
              Percentage rounding goes to the last destination in the listed order. Verify the
              asset, amounts and recipients in your wallet.
            </p>
            {conditional && conditionalHostedPrepared(prepared) && (
              <ConditionalHostedPaymentReview
                prepared={prepared}
                acknowledged={acknowledged === prepared.prepared.txHash}
                onAcknowledge={(checked) =>
                  setAcknowledged(checked ? prepared.prepared.txHash : null)
                }
                disabled={busy}
              />
            )}
            {conditional && (currentError || knownStale) && (
              <p role="status" className="text-error">
                Current complete graph terms cannot authorize this original review. Signing is
                unavailable; keep checking the original receipt.
              </p>
            )}
            <button
              type="button"
              className="btn-primary"
              disabled={
                busy ||
                pending?.phase !== "prepared" ||
                !enabled ||
                (conditional &&
                  (currentError || knownStale || acknowledged !== prepared.prepared.txHash))
              }
              onClick={sign}
            >
              Sign and pay
            </button>
            <button
              type="button"
              className="btn-secondary ml-3"
              disabled={busy}
              onClick={() => {
                setPrepared(null);
                setMessage(
                  "Inputs may be edited after this preparation is reconciled. Check its receipt; no signature has been requested.",
                );
              }}
            >
              Leave review
            </button>
          </section>
        )}
        {conditional &&
          pending &&
          enabled &&
          (pending.phase === "ownership" ||
            pending.phase === "preparing" ||
            pending.phase === "prepared") && (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || blocked}
              onClick={connect}
            >
              Connect original payer wallet
            </button>
          )}
        {pending && (
          <section
            className="border-outline-variant space-y-2 rounded border p-4"
            aria-label={
              pending.phase === "ownership" ? "Wallet ownership verification" : "Payment receipt"
            }
          >
            <h2 className="text-lg">
              {pending.phase === "ownership"
                ? "Wallet ownership verification"
                : "Original payment receipt"}
            </h2>
            {pending.txHash && <p className="font-mono text-xs break-all">{pending.txHash}</p>}
            {conditional && (
              <details open>
                <summary className="min-h-11 cursor-pointer">Original saved payment inputs</summary>
                <p className="text-sm break-all">
                  Original payer: {pending.request.from}; amount: {pending.request.amount} stroops.
                </p>
                {pending.request.arguments?.inputs.map((input) => (
                  <div key={input.nodeId} className="text-sm break-all">
                    <p>
                      {input.nodeId} ({input.kind})
                    </p>
                    {input.kind === "pay" ? (
                      <p>{input.recipient}</p>
                    ) : (
                      <>
                        <p>
                          {input.rows
                            .map(
                              (row) =>
                                `${row.rowId}: ${row.recipient ?? "stored recipient"}; ${row.allocation?.kind === "fixed" ? `${row.allocation.amountStroops} stroops` : row.allocation?.kind === "percentage" ? `${row.allocation.bps} bps` : "stored allocation"}`,
                            )
                            .join("; ")}
                        </p>
                        {input.additionalRecipients?.map((row) => (
                          <p key={row.rowId}>
                            {row.rowId}: {row.recipient};{" "}
                            {row.allocation.kind === "fixed"
                              ? `${row.allocation.amountStroops} stroops`
                              : `${row.allocation.bps} bps`}
                          </p>
                        ))}
                      </>
                    )}
                  </div>
                ))}
              </details>
            )}
            <p className="text-sm">
              {pending.phase === "ownership"
                ? "No payment has been prepared. You can retry the sign-only ownership proof or edit your inputs."
                : "Keep this browser’s receipt until finality is confirmed. An interrupted payment signature or unknown status never means it is safe to pay again."}
            </p>
            {conditional && pending.phase === "preparing" && (
              <p className="text-sm">
                This original request remains held even if current branch inputs become obsolete or
                a server row is not yet visible. Only the same request and key may be recovered;
                missing data, validation failure or time passing does not permit a replacement.
              </p>
            )}
            {pending.phase !== "ownership" && (
              <button
                type="button"
                className="btn-secondary"
                disabled={busy || blocked}
                onClick={reconcile}
              >
                Check payment status
              </button>
            )}
            {pending.phase === "ownership" && (
              <button
                type="button"
                className="btn-secondary"
                disabled={busy || blocked}
                onClick={() =>
                  action(async () => {
                    const saved = readHostedRecovery(storageKey);
                    if (saved?.phase !== "ownership" || saved.recoveryKey !== pending.recoveryKey)
                      throw new Error("Payment state changed; check its original receipt");
                    clearHostedUiRecovery(storageKey, saved, protocol);
                    setPending(null);
                    setPrepared(null);
                    setMessage(
                      "Ownership verification cancelled. Edit your inputs before preparing a payment.",
                    );
                  })
                }
              >
                Edit payment inputs
              </button>
            )}
            {enabled &&
              address &&
              (pending.phase === "ownership" ||
                pending.phase === "preparing" ||
                pending.phase === "prepared") &&
              !prepared && (
                <button
                  type="button"
                  className="btn-secondary ml-2"
                  disabled={busy || blocked}
                  onClick={() => prepare(true)}
                >
                  Recover preparation
                </button>
              )}
          </section>
        )}
        {error && (
          <p role="alert" className="text-error break-words">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="break-words">
            {message}
          </p>
        )}
      </div>
    </main>
  );
}
