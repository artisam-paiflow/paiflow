"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { isConditionalCanvas, type OrdinaryFlowGraph } from "@/lib/flows/ordinary-schema";

import { MutationReconciledSchema } from "@/lib/mutations/schema";
import { TransactionStatusSchema } from "@/lib/api/v1/schema";
import { signWithRecovery } from "@/lib/wallet-signing-recovery";
import { withContractCallLock } from "@/lib/contract-call-pending";
import { formatStroops } from "@/lib/utils";
import {
  buttonClass,
  primaryClass,
  managementRequest,
  ManagementError,
} from "@/components/developer/api";
import { connectSelectedWallet } from "./selected-wallet-connection";
import { InitialConfigurationValues } from "./configuration-values";
import { EditorConfigurationValues as ConfigurationValues } from "./conditional-configuration-values";
import {
  editorProtocol,
  readEditorRecovery,
  saveEditorRecovery,
  conditionalRecovery,
  editorValues,
  editorObligations,
  editorAsset,
  editorRevisionKey as configurationRevisionKey,
  editorChanges as configurationChanges,
  editorAssertPrepared as assertConfigurationPrepared,
  editorAssertRefusal as assertConfigurationRefusal,
  editorProposed,
  type EditorRecovery as ConfigurationRecovery,
  type EditorState as ConfigurationState,
  type EditorDraft,
  type EditorHistory as History,
} from "./configuration-protocol";
import { sameConfigurationUuid } from "./conditional-configuration-editor.utils";
import {
  configurationRecoveryKey,
  CONFIGURATION_RECOVERY_EVENT,
  configurationOutcomeIsTerminal,
} from "./configuration-editor.utils";

type Connection = NonNullable<Awaited<ReturnType<typeof connectSelectedWallet>>>;
export default function ConfigurationPanel({
  ownerId,
  deploymentId,
  network,
  initialGraph,
}: {
  ownerId: string;
  deploymentId: string;
  network: "testnet" | "mainnet";
  initialGraph: OrdinaryFlowGraph;
}) {
  const base = `/api/deployments/${deploymentId}/configuration`;
  const conditional = isConditionalCanvas(initialGraph);
  const protocol = editorProtocol(conditional);
  const sameId = (a: string, b: string) => (conditional ? sameConfigurationUuid(a, b) : a === b);
  const key = configurationRecoveryKey(ownerId, network, deploymentId);
  const [current, setCurrent] = useState<ConfigurationState | null>(null);
  const [reviewed, setReviewed] = useState<ConfigurationState | null>(null);
  const [drafts, setDrafts] = useState<EditorDraft[]>([]);
  const [history, setHistory] = useState<History | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ConfigurationRecovery | null>(null);
  const [ready, setReady] = useState(false),
    [storageError, setStorageError] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [fields, setFields] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false),
    [wallet, setWallet] = useState("");
  const [verifiedPrepared, setVerifiedPrepared] = useState<string | null>(null);
  const connection = useRef<Connection | null>(null),
    inFlight = useRef(false),
    lifetime = useRef<AbortController | null>(null);
  const asset = initialGraph.nodes.find((n) => n.type === "on_receive")?.config.asset;
  function read() {
    const r = readEditorRecovery(key);
    if (
      r &&
      (!sameId(r.ownerId, ownerId) ||
        !sameId(r.deploymentId, deploymentId) ||
        r.network !== network ||
        conditionalRecovery(r) !== conditional)
    )
      throw new Error("Saved update belongs to another owner, deployment or network.");
    return r;
  }
  function save(r: ConfigurationRecovery, previous?: ConfigurationRecovery) {
    if (previous && JSON.stringify(read()) !== JSON.stringify(previous))
      throw new Error("Original update recovery changed in another tab. No action continued.");
    saveEditorRecovery(key, r);
    setSaved(r);
  }
  function stateIdentity(s: ConfigurationState) {
    if (!sameId(s.deploymentId, deploymentId) || s.network !== network)
      throw new Error("Configuration response belongs to a different deployment or network.");
    return s;
  }
  async function loadCurrent(signal?: AbortSignal) {
    const scope = lifetime.current;
    try {
      return stateIdentity(
        await managementRequest(protocol.url(base), protocol.stateSchema, { signal }),
      );
    } catch (error) {
      if (!signal?.aborted && scope === lifetime.current && !scope?.signal.aborted) {
        setCurrent(null);
        setReadError(
          "Current configuration could not be verified. Editing and signing are unavailable until a fresh chain read succeeds.",
        );
      }
      throw error;
    }
  }
  async function loadHistory(cursor?: string, signal?: AbortSignal) {
    try {
      const page = await managementRequest(
        protocol.url(
          base,
          "/history",
          `limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        ),
        protocol.historySchema,
        { signal },
      );
      if (!sameId(page.deploymentId, deploymentId) || page.network !== network)
        throw new Error("History identity differs from this deployment.");
      if (signal?.aborted) return;
      setHistory((previous) =>
        cursor && previous
          ? ({
              ...page,
              items: [
                ...new Map([...previous.items, ...page.items].map((i) => [i.id, i])).values(),
              ],
            } as History)
          : page,
      );
      setHistoryError(null);
    } catch (e) {
      if (!signal?.aborted)
        setHistoryError(e instanceof Error ? e.message : "Observed history unavailable.");
    }
  }
  useEffect(() => {
    const scope = new AbortController();
    lifetime.current = scope;
    connection.current = null;
    setWallet("");
    setVerifiedPrepared(null);
    const sync = () => {
      try {
        setSaved(read());
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
      setReady(true);
    };
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(CONFIGURATION_RECOVERY_EVENT, sync);
    let fetching = false;
    const refresh = async () => {
      if (fetching || inFlight.current) return;
      fetching = true;
      try {
        const state = await loadCurrent(scope.signal);
        if (!scope.signal.aborted) {
          setCurrent(state);
          setReadError(null);
          setReviewed((previous) => previous ?? state);
          setDrafts((previous) =>
            previous.length ? previous : structuredClone(editorValues(state)),
          );
        }
      } catch {
        if (!scope.signal.aborted) {
          setCurrent(null);
          setReadError(
            "Current configuration could not be verified. Editing and signing are unavailable until a fresh chain read succeeds.",
          );
        }
      } finally {
        fetching = false;
      }
    };
    void refresh();
    void loadHistory(undefined, scope.signal);
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      scope.abort();
      clearInterval(timer);
      window.removeEventListener("storage", sync);
      window.removeEventListener(CONFIGURATION_RECOVERY_EVENT, sync);
    };
  }, [key]);
  const revision = current ? configurationRevisionKey(current) : null;
  useEffect(() => {
    if (revision) void loadHistory(undefined, lifetime.current?.signal);
  }, [revision]);
  async function action(run: (check: () => void) => Promise<void>) {
    if (inFlight.current) return;
    const scope = lifetime.current;
    const check = () => {
      if (!scope || scope !== lifetime.current)
        throw new Error("Deployment changed during the action.");
      scope.signal.throwIfAborted();
    };
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await withContractCallLock(key, async () => {
        check();
        await run(check);
        check();
      });
    } catch (e) {
      if (scope === lifetime.current && !scope?.signal.aborted) {
        setError(
          e instanceof z.ZodError
            ? `Check the proposed stored values: ${e.issues.map((i) => i.message).join("; ")}`
            : e instanceof Error
              ? e.message
              : "The action did not complete. Retain the original update.",
        );
        if (e instanceof ManagementError) setFields(e.fields);
      }
    } finally {
      inFlight.current = false;
      if (scope === lifetime.current && !scope?.signal.aborted) setBusy(false);
    }
  }
  async function connect(check: () => void) {
    const { getWalletKit } = await import("./wallet-kit");
    check();
    const selected = await connectSelectedWallet(
      await getWalletKit(network),
      network,
      lifetime.current!.signal,
    );
    check();
    if (selected) {
      connection.current = selected;
      setWallet(selected.address);
    }
  }
  function assertOutcome(
    result: z.infer<typeof MutationReconciledSchema>,
    r: ConfigurationRecovery,
  ) {
    if (
      !r.prepared ||
      !sameId(result.intent, r.prepared.intent) ||
      result.transaction.txHash !== r.prepared.txHash ||
      result.transaction.network !== network
    )
      throw new Error(
        "The reconciliation receipt differs from the original update. Recovery retained.",
      );
    if (
      ["SUCCESS", "FAILED", "EXPIRED"].includes(result.state) &&
      !configurationOutcomeIsTerminal(result)
    )
      throw new Error(
        "The original update's finality evidence is inconsistent. Recovery retained.",
      );
  }
  async function outcome(r: ConfigurationRecovery, check: () => void) {
    if (!r.prepared) throw new Error("Recover the original preparation before reconciling.");
    const result = await managementRequest(
      protocol.url(base, "/reconcile"),
      MutationReconciledSchema,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: r.prepared.intent }),
      },
    );
    check();
    assertOutcome(result, r);
    const next = protocol.parseRecovery({
      ...r,
      result,
      phase: configurationOutcomeIsTerminal(result)
        ? "final"
        : result.state === "SUBMITTING"
          ? "held"
          : r.phase,
    });
    save(next, r);
    return next;
  }
  async function requestOriginal(r: ConfigurationRecovery, check: () => void) {
    try {
      const prepared = await managementRequest(
        protocol.url(base, "/prepare"),
        protocol.preparedSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json", "Idempotency-Key": r.key },
          body: JSON.stringify(r.request),
        },
      );
      check();
      assertConfigurationPrepared(prepared, r.reviewed, r.request);
      if (r.prepared && JSON.stringify(prepared) !== JSON.stringify(r.prepared))
        throw new Error(
          "Original preparation differs from its authoritative receipt. Recovery retained; no signature requested.",
        );
      const next = protocol.parseRecovery({
        ...r,
        prepared,
        refusal: null,
        phase: r.phase === "preparing" || r.phase === "refused" ? "prepared" : r.phase,
      });
      save(next, r);
      return outcome(next, check);
    } catch (e) {
      check();
      if (e instanceof ManagementError && e.fields.preparationRefusal?.length === 1) {
        const proof = await assertConfigurationRefusal(
          JSON.parse(e.fields.preparationRefusal[0]!),
          r,
        );
        check();
        if (r.prepared)
          throw new Error("A refusal cannot erase an admitted update. Recovery retained.");
        const next = protocol.parseRecovery({
          ...r,
          phase: "refused",
          refusal: proof,
          result: null,
        });
        save(next, r);
        setFields(e.fields);
        setError(
          `${e.message} This preparation was not admitted and cannot be admitted later. Review current terms to verify the outcome before trying again.`,
        );
        return next;
      }
      throw e;
    }
  }
  async function prepare(check: () => void) {
    let r = read();
    if (r && r.phase !== "preparing")
      throw new Error("Resolve the original update before preparing another.");
    if (!r) {
      if (
        !reviewed ||
        !current ||
        configurationRevisionKey(reviewed) !== configurationRevisionKey(current)
      )
        throw new Error("Current terms changed. Refresh the review before preparing.");
      if (editorObligations(current).some((o) => o.obligationsStroops !== "0"))
        throw new Error("Unsettled path obligations block updates.");
      const request = configurationChanges(reviewed, drafts);
      r = protocol.parseRecovery({
        ...(conditional ? { version: 2 } : {}),
        ownerId,
        deploymentId,
        network,
        key: crypto.randomUUID(),
        request,
        reviewed,
        phase: "preparing",
        prepared: null,
        result: null,
        refusal: null,
      });
      save(r); // Original immutable identity exists BEFORE a preparation request leaves this tab.
    }
    const next = await requestOriginal(r, check);
    if (next.phase === "refused") {
      return;
    }
    setVerifiedPrepared(JSON.stringify(next.prepared));
    toast.success("Original update prepared. Review current and proposed terms before signing.");
  }
  async function loadReview(check: () => void) {
    const r = read();
    if (!r) throw new Error("No original update is stored.");
    const next = await requestOriginal(r, check);
    if (next.phase === "refused") {
      return;
    }
    const state = await loadCurrent();
    check();
    setCurrent(state);
    setReadError(null);
    if (configurationRevisionKey(state) !== configurationRevisionKey(next.reviewed))
      throw new Error(
        "Configuration changed after preparation. Do not sign stale terms; reconcile the original intent until its outcome is established.",
      );
    setVerifiedPrepared(JSON.stringify(next.prepared));
  }
  async function reconcile(check: () => void) {
    const r = read();
    if (!r?.prepared) throw new Error("Retry the original request to recover its intent first.");
    const next = await outcome(r, check);
    if (next.phase === "final") {
      const state = await loadCurrent();
      check();
      setCurrent(state);
      setReadError(null);
      await loadHistory();
      check();
      toast.success(
        next.result?.state === "SUCCESS"
          ? "Stored update confirmed."
          : "Original update has a verified terminal outcome.",
      );
    }
  }
  async function resetReview(check: () => void) {
    const r = read();
    if (!r) throw new Error("No update to verify.");
    // Stored final/refused labels are untrusted. Obtain fresh authoritative evidence
    // under the action lock before replacing any recovery identity.
    const verified =
      r.phase === "refused" ? await requestOriginal(r, check) : await outcome(r, check);
    if (verified.phase !== "final" && verified.phase !== "refused")
      throw new Error("Original outcome remains uncertain. No new preparation is allowed.");
    const state = await loadCurrent();
    check();
    if (JSON.stringify(read()) !== JSON.stringify(verified))
      throw new Error("Recovery changed in another tab.");
    localStorage.removeItem(key);
    if (localStorage.getItem(key) !== null) throw new Error("Recovery could not be advanced.");
    window.dispatchEvent(new Event(CONFIGURATION_RECOVERY_EVENT));
    setSaved(null);
    setVerifiedPrepared(null);
    setCurrent(state);
    setReviewed(state);
    setDrafts(structuredClone(editorValues(state)));
    setReadError(null);
    setError(null);
    setFields({});
  }
  async function sign(check: () => void) {
    const r = read(),
      selected = connection.current;
    if (
      !r?.prepared ||
      r.phase !== "prepared" ||
      !selected ||
      selected.address !== r.request.admin ||
      verifiedPrepared !== JSON.stringify(r.prepared)
    )
      throw new Error(
        "Connect the original admin wallet and load the authoritative original review first.",
      );
    const latest = await requestOriginal(r, check);
    if (latest.phase !== "prepared" || !latest.prepared || latest.result?.state !== "PREPARED")
      throw new Error("Original intent is no longer awaiting its first signature. Reconcile it.");
    const state = await loadCurrent();
    check();
    setCurrent(state);
    setReadError(null);
    if (
      configurationRevisionKey(state) !== configurationRevisionKey(latest.reviewed) ||
      editorObligations(state).some((o) => o.obligationsStroops !== "0")
    )
      throw new Error(
        "A revision or unsettled obligation changed. No signature requested; reconcile the original update.",
      );
    if (Date.parse(latest.prepared.expiresAt) <= Date.now())
      throw new Error(
        "The preparation expired. Only authoritative reconciliation can permit a new review.",
      );
    const prepared = latest.prepared;
    const signingCheck = () => {
      check();
      if (connection.current !== selected) throw new Error("Admin wallet changed during signing.");
    };
    const signed = await signWithRecovery({
      network,
      address: selected.address,
      xdr: prepared.xdr,
      networkPassphrase: prepared.networkPassphrase,
      check: signingCheck,
      save: (attempt) => {
        if (attempt.txHash !== prepared.txHash)
          throw new Error("Prepared transaction hash differs from the reviewed receipt.");
        save(
          protocol.parseRecovery({ ...latest, phase: "signing", attemptId: attempt.attemptId }),
          latest,
        );
      },
      read: () => {
        const actual = read();
        return actual?.prepared && (actual.phase === "signing" || actual.phase === "submitted")
          ? { txHash: actual.prepared.txHash, phase: actual.phase, attemptId: actual.attemptId }
          : null;
      },
      clearRejected: (attempt) => {
        const actual = read();
        if (actual?.phase === "signing" && actual.attemptId === attempt.attemptId)
          save(protocol.parseRecovery({ ...latest, phase: "prepared" }), actual);
      },
      sign: () =>
        selected.signTransaction(prepared.xdr, {
          address: selected.address,
          networkPassphrase: prepared.networkPassphrase,
        }),
    });
    const actual = read();
    if (actual?.phase !== "signing" || actual.attemptId !== signed.attempt.attemptId)
      throw new Error("Signing recovery changed; no send started.");
    const submitted = protocol.parseRecovery({ ...actual, phase: "submitted" });
    save(submitted, actual);
    const result = await managementRequest(protocol.url(base, "/submit"), TransactionStatusSchema, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: prepared.intent, signedXdr: signed.signedTxXdr }),
    });
    check();
    if (result.txHash !== prepared.txHash || result.network !== network)
      throw new Error(
        "Submission receipt does not match the original update. Reconcile its retained hash.",
      );
    // A successful HTTP response, queue refusal or timeout never clears the marker.
    await outcome(submitted, check);
    toast.success(
      result.status === "SUCCESS"
        ? "Stored update confirmed."
        : "Original update recorded. Reconcile its hash for finality.",
    );
  }
  const unresolved = !!saved && saved.phase !== "final" && saved.phase !== "refused";
  const changed =
    !!current &&
    !!reviewed &&
    configurationRevisionKey(current) !== configurationRevisionKey(reviewed);
  const blocked = !!current && editorObligations(current).some((o) => o.obligationsStroops !== "0");
  const originalChanged =
    !!current &&
    !!saved &&
    configurationRevisionKey(current) !== configurationRevisionKey(saved.reviewed);
  let proposed: EditorDraft[] | null = null;
  if (saved?.prepared) {
    try {
      proposed = editorProposed(saved);
    } catch {
      /* Invalid local review is never signable. */
    }
  }
  return (
    <section
      className="glass-panel space-y-4 rounded-xl p-4 sm:p-6"
      aria-labelledby={`configuration-${deploymentId}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`configuration-${deploymentId}`} className="text-lg font-semibold">
          Stored configuration
        </h2>
        <span
          data-testid="network-chip"
          className="border-outline-variant rounded border px-2 py-1 font-mono text-xs"
        >
          {network.toUpperCase()}
        </span>
      </div>
      <p className="text-on-surface-variant text-sm">
        Only declared stored fields may change. Constants, modes, routing, assets and configured row
        identities remain fixed. The admin signs and pays the transaction fee. Unsettled obligations
        anywhere in the path block updates.
      </p>
      {readError && (
        <p role="status" className="text-error">
          {readError}
        </p>
      )}
      <button
        type="button"
        className={buttonClass}
        disabled={busy || !ready}
        onClick={() =>
          void action(async (check) => {
            const state = await loadCurrent();
            check();
            setCurrent(state);
            setReadError(null);
            setReviewed((previous) => previous ?? state);
            setDrafts((previous) =>
              previous.length ? previous : structuredClone(editorValues(state)),
            );
          })
        }
      >
        Check current configuration
      </button>
      {storageError && (
        <p role="alert" className="text-error">
          Saved update recovery is unreadable. No new preparation or signature is allowed. Resolve
          the original update.
        </p>
      )}
      {error && (
        <p role="alert" className="text-error break-words">
          {error}
        </p>
      )}
      {Object.entries(fields)
        .filter(([name]) => name !== "preparationRefusal")
        .map(([name, messages]) => (
          <p key={name} role="alert" className="text-error break-words">
            {name}: {messages.join("; ")}
          </p>
        ))}
      {current && (
        <>
          <p className="text-sm">
            Current configuration confirmed at ledger {current.confirmedLedger}. Rechecked every 15
            seconds. External changes require a new review.
          </p>
          <p className="text-sm break-all">Admin / fee payer: {current.admin}</p>
          <p className="text-xs break-all">Asset contract: {editorAsset(current)}</p>
          <h3 className="font-medium">Current confirmed values</h3>
          <ConfigurationValues values={editorValues(current)} asset={asset} />
          <ul className="text-sm">
            {editorObligations(current).map((o) => (
              <li key={o.nodeId}>
                {o.nodeId}: unsettled obligations {o.obligationsStroops} stroops
              </li>
            ))}
          </ul>
          {blocked && (
            <p role="status" className="text-error">
              Updates are blocked by unsettled obligations. A zero wallet or contract balance does
              not clear them.
            </p>
          )}
        </>
      )}
      {!conditional && <InitialConfigurationValues graph={initialGraph} />}
      {conditional && current && (
        <details className="border-outline-variant/50 rounded border p-3">
          <summary className="min-h-11 cursor-pointer">Immutable conditional review rules</summary>
          <p className="text-sm">
            The full Receive/Pay prefix and both terminal branches are bound to every update. The
            condition compares after upstream Pay deductions; equality always takes False. Return to
            owner pays the immutable deployment owner: {current.admin}. Initial deployment terms are
            retained above and never replaced by these current values.
          </p>
        </details>
      )}
      {!saved && current && reviewed && (
        <>
          {changed && (
            <p role="status" className="text-error">
              Configuration changed externally after this review began. Refresh the review before
              preparing.
            </p>
          )}
          <button
            type="button"
            className={buttonClass}
            disabled={busy || !ready || storageError}
            onClick={() =>
              void action(async (check) => {
                const state = await loadCurrent();
                check();
                if (read()) throw new Error("Recover the original update first.");
                setCurrent(state);
                setReviewed(state);
                setDrafts(structuredClone(editorValues(state)));
                setReadError(null);
              })
            }
          >
            Refresh review from chain
          </button>
          <h3 className="font-medium">Proposed stored values</h3>
          <ConfigurationValues
            values={drafts}
            asset={asset}
            disabled={busy || changed || blocked || storageError}
            onChange={setDrafts}
          />
          <button
            type="button"
            className={primaryClass}
            disabled={busy || !ready || storageError || changed || blocked}
            onClick={() => void action(prepare)}
          >
            Prepare update
          </button>
        </>
      )}
      {saved && (
        <div className="border-outline-variant space-y-3 rounded border p-3">
          <p role="status">
            Original update:{" "}
            {saved.phase === "final"
              ? saved.result?.state === "SUCCESS"
                ? "confirmed"
                : saved.result?.state === "FAILED"
                  ? "failed on chain"
                  : "verified expired without inclusion"
              : (
                  {
                    preparing: "preparation response pending",
                    prepared: "ready for review",
                    signing: "signature pending / unknown",
                    submitted: "submission pending / unknown",
                    held: "pending / unknown",
                    refused: "preparation refused before admission",
                  } as const
                )[saved.phase]}
          </p>
          {saved.prepared && (
            <>
              <details>
                <summary className="min-h-11 cursor-pointer text-sm">
                  Update recovery details
                </summary>
                <p className="font-mono text-xs break-all">
                  Update reference: {saved.prepared.intent}
                </p>
              </details>
              <p className="font-mono text-xs break-all">Transaction: {saved.prepared.txHash}</p>
              <p className="text-sm">
                Maximum fee: {formatStroops(saved.prepared.feeStroops)} XLM (
                {saved.prepared.feeStroops} stroops). Valid until {saved.prepared.expiresAt}. Time
                passing does not prove failure.
              </p>
              <h3 className="font-medium">Reviewed values before this update</h3>
              <ConfigurationValues values={editorValues(saved.reviewed)} asset={asset} />
              {proposed && (
                <>
                  <h3 className="font-medium">Proposed values in the original update</h3>
                  <ConfigurationValues
                    values={proposed}
                    asset={asset}
                    revisionLabel="expected current revision"
                  />
                  <p className="text-on-surface-variant text-xs">
                    Each changed node advances its revision once only after the update confirms.
                  </p>
                </>
              )}
              <p className="text-sm">
                Expected path revisions:{" "}
                {saved.prepared.mutation.nodes
                  .map((n) => `${n.nodeId}: ${n.expectedRevision}`)
                  .join("; ")}
              </p>
            </>
          )}
          {saved.refusal && (
            <>
              <p className="text-sm">
                This preparation was not admitted and cannot be admitted later. Verify its outcome
                before reviewing new terms.
              </p>
              <details>
                <summary className="min-h-11 cursor-pointer text-sm">
                  Preparation recovery details
                </summary>
                <p className="text-xs break-all">
                  Refusal reference: {saved.refusal.refusalId}. Reason: {saved.refusal.reasonCode}.
                </p>
              </details>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {saved.phase === "preparing" && (
              <button
                type="button"
                className={buttonClass}
                disabled={busy || storageError}
                onClick={() => void action(prepare)}
              >
                Retry original preparation
              </button>
            )}
            {saved.prepared && saved.phase === "prepared" && (
              <button
                type="button"
                className={buttonClass}
                disabled={busy || storageError || !current}
                onClick={() => void action(loadReview)}
              >
                Load original signing review
              </button>
            )}
            {saved.prepared && unresolved && (
              <button
                type="button"
                className={buttonClass}
                disabled={busy || storageError}
                onClick={() => void action(reconcile)}
              >
                Reconcile original update
              </button>
            )}
            {(saved.phase === "final" || saved.phase === "refused") && (
              <button
                type="button"
                className={buttonClass}
                disabled={busy || storageError}
                onClick={() => void action(resetReview)}
              >
                Review current terms
              </button>
            )}
          </div>
          {originalChanged && (
            <p role="status" className="text-error">
              Bound configuration changed after the original review. Signing is unavailable;
              reconcile the retained original update.
            </p>
          )}
          {saved.phase === "prepared" && (
            <>
              <button
                type="button"
                className={buttonClass}
                disabled={busy || storageError}
                onClick={() => void action(connect)}
              >
                Connect admin wallet
              </button>
              {wallet && (
                <p className="text-sm break-all">
                  Connected wallet: {wallet}
                  {wallet !== saved.request.admin
                    ? " · This is not the original admin wallet."
                    : ""}
                </p>
              )}
              <button
                type="button"
                className={primaryClass}
                disabled={
                  busy ||
                  storageError ||
                  !current ||
                  blocked ||
                  originalChanged ||
                  wallet !== saved.request.admin ||
                  verifiedPrepared !== JSON.stringify(saved.prepared) ||
                  !proposed
                }
                onClick={() => void action(sign)}
              >
                Sign exact update
              </button>
            </>
          )}
          {unresolved && (
            <p className="text-on-surface-variant text-xs">
              Keep the original request, key, intent and hash. Unknown signing or finality does not
              permit a replacement, cancellation or another key. Reconciliation never signs or
              sends.
            </p>
          )}
        </div>
      )}
      <details className="border-outline-variant/50 space-y-3 rounded border p-3">
        <summary className="min-h-11 cursor-pointer">
          Confirmed observed configuration history
        </summary>
        <p className="text-sm">
          Observed revisions only. This is not complete history and never substitutes for a current
          chain read. Observation and event ledgers are separate evidence.
        </p>
        {historyError && (
          <p role="status" className="text-error">
            {historyError}
          </p>
        )}
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => void loadHistory()}
        >
          Refresh observed history
        </button>
        {history?.revisionCoverage.map((c) => (
          <p key={c.nodeId} className="text-sm">
            {c.nodeId}: highest observed revision {c.highestObservedRevision}; retained{" "}
            {c.observedRevisionCount}; missing revisions {c.missingRevisionCount}.
          </p>
        ))}
        {history?.items.map((item) => (
          <div key={item.id} className="border-outline-variant/30 space-y-2 border-t pt-3">
            <p className="text-sm break-all">
              Observed ledger {item.observedLedger}
              {item.eventLedger
                ? ` · confirmed update event ledger ${item.eventLedger}`
                : " · update event not observed"}
              {item.txHash ? ` · transaction ${item.txHash}` : ""}
            </p>
            <ConfigurationValues values={[item.configuration]} asset={asset} />
          </div>
        ))}
        {history?.nextCursor && (
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => void loadHistory(history.nextCursor!)}
          >
            Load older observations
          </button>
        )}
      </details>
    </section>
  );
}
