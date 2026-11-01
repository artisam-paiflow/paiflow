"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ExecutePrepareSchema } from "@/lib/api/v1/schema";
import { ExecutionDiscoverySchema } from "@/lib/api/v1/execution-schema";
import { assertExecutionValues } from "@/lib/api/v1/execution-values";
import { withContractCallLock } from "@/lib/contract-call-pending";
import { formatStroops } from "@/lib/utils";
import { signWithRecovery } from "@/lib/wallet-signing-recovery";
import {
  HostedPreparedSchema,
  HostedReceiptSchema,
  HostedOwnershipChallengeSchema,
  type HostedPrepared,
} from "@/lib/hosted-execution/schema";
import { assertHostedOwnershipChallenge } from "@/lib/stellar/hosted-ownership-transaction";
import { signedWalletTransactionHash } from "@/lib/stellar/wallet-signature";
import {
  fieldKey,
  formArguments,
  hostedRecoveryStorageKey,
  readHostedRecovery,
  saveHostedRecovery,
  tokenInput,
  restoredHostedInputs,
  type AdditionalDraft,
  type HostedBrowserRecovery,
  type HostedState,
} from "@/lib/hosted-execution/form";
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
}: {
  deploymentId: string;
  flowName: string;
  network: "testnet" | "mainnet";
  enabled: boolean;
}) {
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

  useEffect(() => {
    let active = true;
    const read = () => {
      try {
        const saved = readHostedRecovery(storageKey);
        setPending(saved);
        if (saved) {
          const restored = restoredHostedInputs(saved);
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
      }
    };
    window.addEventListener("storage", changed);
    if (enabled)
      void paymentRequest(`${base}/state`)
        .then((data) => {
          const current = ExecutionDiscoverySchema.parse(data);
          if (active && current.supported) setState(current);
        })
        .catch((err) => {
          if (active) setError(err instanceof Error ? err.message : "Payment form unavailable");
        });
    return () => {
      active = false;
      controller.current?.abort();
      window.removeEventListener("storage", changed);
    };
  }, [base, enabled, storageKey]);

  function save(record: HostedBrowserRecovery) {
    saveHostedRecovery(storageKey, record);
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
      if (!enabled || !state) throw new Error("Payment form is unavailable");
      const previous = readHostedRecovery(storageKey);
      if (previous && previous.phase !== "ownership" && previous.phase !== "preparing" && !resume)
        throw new Error("Check the previous payment before preparing another");
      if (previous?.phase === "signing" || previous?.phase === "submitted")
        throw new Error(
          "Signing or finality is unresolved. Check the original payment without signing again.",
        );
      const selected = activeConnection();
      const arguments_ = previous
        ? previous.request.arguments
        : formArguments(state, fields, rosters);
      const payment = previous
        ? previous.request
        : ExecutePrepareSchema.parse({
            from: selected.address,
            amount: tokenInput(amount),
            arguments: arguments_,
          });
      if (payment.from !== selected.address)
        throw new Error("Connect the original payer wallet to recover this preparation");
      assertExecutionValues(
        state.policies,
        state.configurations,
        payment.arguments ?? { version: 1, inputs: [] },
        payment.amount,
      );
      const ownershipOnly = !previous || previous.phase === "ownership";
      const record: HostedBrowserRecovery = {
        recoveryKey: previous?.recoveryKey ?? randomRecoveryKey(),
        request: payment,
        phase: ownershipOnly ? "ownership" : "preparing",
      };
      // Save the capability before a request can succeed with a lost HTTP acknowledgement.
      save(record);
      setPrepared(null);
      const request = { recoveryKey: record.recoveryKey, payment };
      let response: unknown;
      if (ownershipOnly) {
        // A fresh/ownership-only record has never dispatched a signed proof.
        // A missing server row cannot establish this for a restored preparing record:
        // its original request may still be simulating and commit later.
        const challenge = HostedOwnershipChallengeSchema.parse(
          await paymentRequest(`${base}/ownership`, request),
        );
        assertHostedOwnershipChallenge(challenge, selected.address, network);
        setMessage(
          "Verify wallet ownership in your wallet. This sign-only proof cannot move funds. You will review and sign the payment separately.",
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
        // Persist uncertainty before the first request that can reserve the payer.
        save({ ...record, phase: "preparing" });
        // The proof stays in memory and is never sent to a transaction submission route.
        response = await paymentRequest(`${base}/prepare`, {
          ...request,
          ownershipProofXdr: proof.signedTxXdr,
        });
      } else {
        try {
          // Recover only the original exact preparation; do not sign another proof
          // or downgrade uncertainty while a previous server request may be in flight.
          response = await paymentRequest(`${base}/prepare`, request);
        } catch (err) {
          if (err instanceof Error && "ownershipRequired" in err)
            throw new Error(
              "The original preparation may still be in progress. Keep its recovery record and retry later; do not prepare a replacement payment.",
            );
          throw err;
        }
      }
      const result = HostedPreparedSchema.parse(response);
      if (
        result.prepared.network !== network ||
        result.prepared.walletAddress !== payment.from ||
        result.prepared.execution.amountStroops !== payment.amount
      )
        throw new Error("Prepared payment does not match the selected payer or network");
      if (
        JSON.stringify(result.prepared.execution.arguments) !==
        JSON.stringify(payment.arguments ?? { version: 1, inputs: [] })
      )
        throw new Error(
          "Prepared destinations differ from the payment inputs. Check the original receipt.",
        );
      save({
        ...record,
        phase: "prepared",
        intent: result.prepared.intent,
        txHash: result.prepared.txHash,
      });
      setPrepared(result);
      setMessage(null);
    });
  }
  async function sign() {
    await action(async () => {
      if (!prepared) throw new Error("Prepare and review this payment first");
      if (Date.parse(prepared.prepared.expiresAt) <= Date.now())
        throw new Error("This preparation has expired. Check its receipt before preparing again.");
      const saved = readHostedRecovery(storageKey);
      const selected = activeConnection();
      if (
        !saved ||
        saved.phase !== "prepared" ||
        saved.intent !== prepared.prepared.intent ||
        saved.txHash !== prepared.prepared.txHash ||
        selected.address !== prepared.prepared.walletAddress
      )
        throw new Error(
          "The reviewed payment or wallet changed. Check its receipt before continuing.",
        );
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
        save: (attempt) => save({ ...saved, ...attempt }),
        read: () => {
          const record = readHostedRecovery(storageKey);
          return record?.txHash && (record.phase === "signing" || record.phase === "submitted")
            ? { txHash: record.txHash, phase: record.phase, attemptId: record.attemptId }
            : null;
        },
        clearRejected: () => save({ ...saved, phase: "prepared" }),
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
      save({ ...current, phase: "submitted" });
      setPrepared(null);
      // Signed bytes remain in memory only and are never saved to browser storage.
      await paymentRequest(`${base}/submit`, {
        recoveryKey: saved.recoveryKey,
        intent: saved.intent,
        signedXdr: signedTxXdr,
      });
      setMessage("Payment submitted. Check its status before making another payment.");
    });
  }
  async function reconcile() {
    await action(async () => {
      const saved = readHostedRecovery(storageKey);
      if (!saved) throw new Error("No payment receipt is stored in this browser");
      const result = HostedReceiptSchema.parse(
        await paymentRequest(`${base}/receipt`, { recoveryKey: saved.recoveryKey }),
      );
      if (
        result.network !== network ||
        (saved.intent && result.intent !== saved.intent) ||
        (saved.txHash && result.txHash !== saved.txHash)
      )
        throw new Error("Receipt does not match this payment");
      if (["SUCCESS", "FAILED", "EXPIRED"].includes(result.state)) {
        if (readHostedRecovery(storageKey)?.recoveryKey === saved.recoveryKey)
          localStorage.removeItem(storageKey);
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
        save({ ...saved, intent: result.intent, txHash: result.txHash });
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
          disabled={busy || Boolean(pending)}
          onChange={(event) => {
            setPrepared(null);
            onChange(event.target.value);
          }}
        />
      </label>
    );
  }
  function runtimeFields() {
    return state?.policies.nodes.map((policy) => (
      <fieldset className="border-outline-variant space-y-3 rounded border p-3" key={policy.nodeId}>
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
                      disabled={busy || Boolean(pending)}
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
        {!enabled && (
          <p>This payment form is unavailable. A previously stored receipt can still be checked.</p>
        )}
        {enabled && state && (
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
              Asset contract: {state.assetContract}
            </p>
            {input("Payment amount", amount, setAmount, "decimal")}
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
          <section className="glass-panel space-y-3 rounded-xl p-4" aria-label="Review payment">
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
            <button
              type="button"
              className="btn-primary"
              disabled={busy || pending?.phase !== "prepared" || !enabled}
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
            <p className="text-sm">
              {pending.phase === "ownership"
                ? "No payment has been prepared. You can retry the sign-only ownership proof or edit your inputs."
                : "Keep this browser’s receipt until finality is confirmed. An interrupted payment signature or unknown status never means it is safe to pay again."}
            </p>
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
                    localStorage.removeItem(storageKey);
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
