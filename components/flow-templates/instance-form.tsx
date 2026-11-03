"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { CreationBindingsSchema } from "@/lib/flows/field-policies";
import {
  InstancePrepareSchema,
  InstanceStateSchema,
  InstanceListSchema,
  type InstanceState,
} from "@/lib/flow-instances/schema";
import {
  BindingPreviewSchema,
  InstanceInitialReviewSchema,
  type TemplateVersion,
} from "@/lib/flow-templates/client-schema";
import { flowToEnglish } from "@/lib/flows/english";
import { formatStroops } from "@/lib/utils";
import { withContractCallLock } from "@/lib/contract-call-pending";
import { signWithRecovery } from "@/lib/wallet-signing-recovery";
import { connectSelectedWallet } from "@/components/deploy/selected-wallet-connection";
import {
  buttonClass,
  primaryClass,
  managementRequest,
  ManagementError,
} from "@/components/developer/api";
import ValueInput from "./value-input";
import CompiledTerms from "./compiled-terms";
import { parseCreationValue } from "./creation-input.utils";
import {
  readInstanceRecovery,
  writeInstanceRecovery,
  instanceRecoveryKey,
  assertInstanceReceipt,
  type InstanceRecovery,
} from "./instance-recovery.utils";

type Connection = NonNullable<Awaited<ReturnType<typeof connectSelectedWallet>>>;
export default function InstanceForm({
  ownerId,
  username,
  network,
  templateId,
  version,
  retired,
}: {
  ownerId: string;
  username: string;
  network: "testnet" | "mainnet";
  templateId: string;
  version: TemplateVersion;
  retired: boolean;
}) {
  const base = `/api/flow-templates/${templateId}`;
  const storageKey = instanceRecoveryKey(ownerId, network, templateId);
  const [saved, setSaved] = useState<InstanceRecovery | null>(null);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [defaults, setDefaults] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<z.infer<typeof BindingPreviewSchema> | null>(null);
  const [verifiedReview, setVerifiedReview] = useState<z.infer<
    typeof InstanceInitialReviewSchema
  > | null>(null);
  const [address, setAddress] = useState("");
  const connection = useRef<Connection | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [history, setHistory] = useState<InstanceState[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const available =
    !retired &&
    !version.retiredAt &&
    (!version.expiresAt || Date.parse(version.expiresAt) > Date.now()) &&
    version.network === network;
  function read() {
    const r = readInstanceRecovery(storageKey);
    if (r && (r.ownerId !== ownerId || r.templateId !== templateId || r.network !== network))
      throw new Error("Saved recovery belongs to a different owner, template or network");
    return r;
  }
  function save(r: InstanceRecovery) {
    writeInstanceRecovery(storageKey, r);
    setSaved(r);
  }
  useEffect(() => {
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
    window.addEventListener("paiflow-instance-recovery", sync);
    return () => {
      controller.current?.abort();
      window.removeEventListener("storage", sync);
      window.removeEventListener("paiflow-instance-recovery", sync);
    };
  }, [storageKey]);
  async function action(run: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await withContractCallLock(storageKey, run);
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? "Check creation input types and required values. No exemplar fallback is used."
          : e instanceof Error
            ? e.message
            : "Could not continue. Check the original instance.",
      );
      if (e instanceof ManagementError) setFields(e.fields);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function bindings() {
    return CreationBindingsSchema.parse({
      version: 1,
      templateVersionId: version.id,
      values: version.definition.inputs
        .filter((input) => !(input.defaultValue && defaults[input.inputId]))
        .map((input) => ({
          inputId: input.inputId,
          value: parseCreationValue(input.type, values[input.inputId] ?? ""),
        })),
    });
  }
  async function connect() {
    controller.current?.abort();
    controller.current = new AbortController();
    const { getWalletKit } = await import("@/components/deploy/wallet-kit");
    const selected = await connectSelectedWallet(
      await getWalletKit(network),
      network,
      controller.current.signal,
    );
    if (selected) {
      connection.current = selected;
      setAddress(selected.address);
    }
  }
  async function prepare() {
    const old = read();
    if (old && old.phase !== "preparing")
      throw new Error("Recover the original instance before preparing another");
    let r = old;
    if (!r) {
      if (!available || !preview || !connection.current || connection.current.address !== address)
        throw new Error("Review the bound terms and connect the developer wallet first");
      const request = InstancePrepareSchema.parse({
        sourceAccount: address,
        idempotencyKey: crypto.randomUUID(),
        bindings: bindings(),
      });
      r = {
        ownerId,
        templateId,
        versionId: version.id,
        network,
        request,
        graph: preview.graph,
        phase: "preparing",
        receipt: null,
      };
      save(r); // Persist original ordered request/default omissions BEFORE dispatch.
    }
    const receipt = await managementRequest(
      `${base}/versions/${r.versionId}/instances/prepare`,
      InstanceStateSchema,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(r.request),
      },
    );
    assertInstanceReceipt(receipt, {
      templateId,
      versionId: r.versionId,
      network,
      sourceAccount: r.request.sourceAccount,
    });
    save({
      ...r,
      receipt,
      phase:
        receipt.status === "CONFIRMED" || receipt.status === "FAILED"
          ? "final"
          : receipt.status === "PENDING_SIGNATURE"
            ? "prepared"
            : "held",
    });
    await loadReview();
    toast.success("Original instance preparation recovered. Review the fee before signing.");
  }
  async function loadReview() {
    setVerifiedReview(null);
    const r = read();
    if (!r?.receipt) throw new Error("Recover the original preparation first");
    const review = await managementRequest(
      `${base}/instances/${r.receipt.deploymentId}/review`,
      InstanceInitialReviewSchema,
    );
    assertInstanceReceipt(review.receipt, {
      templateId,
      versionId: r.versionId,
      network,
      sourceAccount: r.request.sourceAccount,
      deploymentId: r.receipt.deploymentId,
      txHash: r.receipt.txHash,
    });
    save({
      ...r,
      receipt: review.receipt,
      phase:
        review.receipt.status === "CONFIRMED" || review.receipt.status === "FAILED"
          ? "final"
          : r.phase,
    });
    setVerifiedReview(review);
  }
  async function reconcile() {
    const r = read();
    if (!r?.receipt) throw new Error("Retry the original preparation to recover its instance ID");
    const receipt = await managementRequest(
      `${base}/instances/${r.receipt.deploymentId}/reconcile`,
      InstanceStateSchema,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
    assertInstanceReceipt(receipt, {
      templateId,
      versionId: r.versionId,
      network,
      sourceAccount: r.request.sourceAccount,
      deploymentId: r.receipt.deploymentId,
      txHash: r.receipt.txHash,
    });
    save({
      ...r,
      receipt,
      phase: receipt.status === "CONFIRMED" || receipt.status === "FAILED" ? "final" : r.phase,
    });
  }
  async function sign() {
    const r = read(),
      selected = connection.current;
    if (
      !r ||
      r.phase !== "prepared" ||
      !r.receipt?.prepared ||
      r.receipt.status !== "PENDING_SIGNATURE" ||
      r.versionId !== version.id ||
      !selected ||
      selected.address !== r.request.sourceAccount ||
      !verifiedReview ||
      verifiedReview.receipt.deploymentId !== r.receipt.deploymentId
    )
      throw new Error(
        "Connect the original developer wallet and load the authoritative initial review",
      );
    const receipt = r.receipt,
      prepared = receipt.prepared!;
    const latest = await managementRequest(
      `${base}/instances/${receipt.deploymentId}`,
      InstanceStateSchema,
    );
    assertInstanceReceipt(latest, {
      templateId,
      versionId: r.versionId,
      network,
      sourceAccount: r.request.sourceAccount,
      deploymentId: receipt.deploymentId,
      txHash: prepared.txHash,
    });
    if (
      latest.serviceState !== "ACTIVE" ||
      latest.status !== "PENDING_SIGNATURE" ||
      !latest.prepared ||
      JSON.stringify(latest.prepared) !== JSON.stringify(verifiedReview.receipt.prepared) ||
      JSON.stringify(latest.prepared) !== JSON.stringify(prepared)
    )
      throw new Error(
        "Original preparation changed. Load its authoritative review before signing.",
      );
    if (Date.parse(prepared.expiresAt) <= Date.now())
      throw new Error(
        "The original preparation expired. Check its status; expiry alone does not permit replacement.",
      );
    const check = () => {
      controller.current?.signal.throwIfAborted();
      if (connection.current !== selected) throw new Error("Wallet connection changed");
    };
    const result = await signWithRecovery({
      network,
      address: selected.address,
      xdr: prepared.xdr,
      networkPassphrase: prepared.networkPassphrase,
      check,
      save: (attempt) => {
        if (attempt.txHash !== prepared.txHash) throw new Error("Prepared hash changed");
        save({ ...r, phase: "signing", attemptId: attempt.attemptId });
      },
      read: () => {
        const current = read();
        return current?.receipt?.txHash &&
          (current.phase === "signing" || current.phase === "submitted")
          ? { txHash: current.receipt.txHash, phase: current.phase, attemptId: current.attemptId }
          : null;
      },
      clearRejected: () => save({ ...r, phase: "prepared" }),
      sign: () =>
        selected.signTransaction(prepared.xdr, {
          address: selected.address,
          networkPassphrase: prepared.networkPassphrase,
        }),
    });
    const current = read();
    if (current?.attemptId !== result.attempt.attemptId || current.phase !== "signing")
      throw new Error("Signing attempt changed. Recover the original instance.");
    save({ ...current, phase: "submitted" });
    const updated = await managementRequest(
      `${base}/instances/${receipt.deploymentId}/submit`,
      InstanceStateSchema,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedXdr: result.signedTxXdr }),
      },
    );
    assertInstanceReceipt(updated, {
      templateId,
      versionId: r.versionId,
      network,
      sourceAccount: r.request.sourceAccount,
      deploymentId: receipt.deploymentId,
      txHash: prepared.txHash,
    });
    save({
      ...current,
      receipt: updated,
      phase: updated.status === "CONFIRMED" || updated.status === "FAILED" ? "final" : "submitted",
    });
    toast.success(
      updated.status === "CONFIRMED"
        ? "Instance confirmed."
        : "Submission recorded. Check the original instance status.",
    );
  }
  async function loadHistory(cursor?: string) {
    const page = await managementRequest(
      `${base}/instances?limit=20${cursor ? `&cursor=${cursor}` : ""}`,
      InstanceListSchema,
    );
    if (page.items.some((r) => r.templateId !== templateId || r.network !== network))
      throw new Error("Instance history identity is inconsistent");
    setHistory((old) => (cursor ? [...old, ...page.items] : page.items));
    setNext(page.nextCursor);
    setHistoryLoaded(true);
  }
  const receipt = saved?.receipt;
  const reviewGraph = saved ? verifiedReview?.graph : preview?.graph;
  return (
    <section
      className="ph-no-capture glass-panel space-y-4 rounded-xl p-5"
      aria-label="Create private instance"
    >
      <h3 className="text-xl font-semibold">Create an instance · version {version.version}</h3>
      <span
        data-testid="network-chip"
        className="border-primary/50 text-primary rounded border px-2 py-1 font-mono text-xs"
      >
        {network.toUpperCase()}
      </span>
      <p className="text-sm">
        Owner: {username}. The connected developer wallet is transaction source, initial contract
        admin and fee payer. Each instance has separate contracts and balances. A creation value
        supplies initial terms once; it confers no runtime editing permission.
      </p>
      {!available ? (
        <p role="status">
          This selected version is retired, expired or belongs to another network. New instances are
          unavailable. Original recovery remains available.
        </p>
      ) : null}
      {storageError ? (
        <p role="alert" className="text-error">
          Browser recovery is unavailable or invalid. Resolve the original instance before signing
          or creating another.
        </p>
      ) : null}
      <fieldset
        className="space-y-3"
        disabled={busy || !ready || storageError || !!saved || !available}
      >
        {version.definition.inputs.map((input) => (
          <div key={input.inputId} className="space-y-2">
            <ValueInput
              type={input.type}
              value={values[input.inputId] ?? ""}
              onChange={(value) => {
                setValues({ ...values, [input.inputId]: value });
                setPreview(null);
              }}
              label={`${input.label} (${input.type}${input.type === "bps" ? "; 10000 = 100%" : ""})`}
              disabled={!!defaults[input.inputId]}
            />
            {input.defaultValue ? (
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!defaults[input.inputId]}
                  onChange={(e) => {
                    setDefaults({ ...defaults, [input.inputId]: e.target.checked });
                    setPreview(null);
                  }}
                />
                Use explicit published default: {String(input.defaultValue.value)}
              </label>
            ) : (
              <p className="text-xs">Required — no default</p>
            )}
            {input.constraints ? (
              <p className="text-xs">Declared constraints: {JSON.stringify(input.constraints)}</p>
            ) : null}
          </div>
        ))}
        <button
          className={buttonClass}
          onClick={() =>
            void action(async () => {
              const result = await managementRequest(
                `${base}/versions/${version.id}/bindings`,
                BindingPreviewSchema,
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(bindings()),
                },
              );
              setPreview(result);
            })
          }
        >
          Review bound terms
        </button>
      </fieldset>
      {reviewGraph ? (
        <div className="border-outline-variant/40 space-y-3 rounded border p-4">
          <h4 className="font-semibold">
            {saved ? "Original reviewed initial terms" : "Bound initial terms"}
          </h4>
          {saved && verifiedReview ? (
            <CompiledTerms terms={verifiedReview.compiledTerms} />
          ) : (
            <>
              <p className="text-sm leading-relaxed">{flowToEnglish(reviewGraph)}</p>
              <p className="text-on-surface-variant text-sm">
                Authored bound design preview. Preparation fixes the actual compiled contract terms
                and dates; review those before signing.
              </p>
            </>
          )}
          <p className="text-sm">
            {reviewGraph.fieldPolicies
              ? "Explicit runtime field modes are fixed for this deployment. Constants cannot change; payer inputs are supplied per payment; declared stored mutations require admin authorization on compatible artifacts."
              : "Legacy configured behavior: this graph has no v1 lifetime field-policy guarantees. No new runtime permission is inferred from creation bindings."}
          </p>
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-sm">
              Exact initial bound values, runtime policies and artifacts
            </summary>
            <pre className="overflow-x-auto text-xs">
              {JSON.stringify(saved ? verifiedReview?.bindings : preview?.bindings, null, 2)}
            </pre>
            <pre className="overflow-x-auto text-xs">
              {JSON.stringify(reviewGraph.fieldPolicies ?? "No v1 field policies", null, 2)}
            </pre>
            <pre className="overflow-x-auto text-xs">
              {JSON.stringify(saved ? verifiedReview?.artifacts : preview?.artifacts, null, 2)}
            </pre>
          </details>
        </div>
      ) : null}
      <button
        className={buttonClass}
        disabled={busy || !ready || storageError}
        onClick={() => void action(connect)}
      >
        {address ? "Reconnect developer wallet" : "Connect developer wallet"}
      </button>
      {address ? (
        <p className="font-mono text-xs break-all">
          Connected source / admin / fee payer: {address}
        </p>
      ) : null}
      {!saved ? (
        <button
          className={primaryClass}
          disabled={busy || !ready || storageError || !available || !preview || !address}
          onClick={() => void action(prepare)}
        >
          Prepare exact instance
        </button>
      ) : null}
      {saved?.phase === "preparing" ? (
        <>
          <p role="status">
            Original preparation pending or outcome unknown. Keep this request and key; do not
            create a replacement.
          </p>
          <button
            className={buttonClass}
            disabled={busy || storageError}
            onClick={() => void action(prepare)}
          >
            Recover original preparation
          </button>
        </>
      ) : null}
      {receipt ? (
        <div className="space-y-3">
          <p role="status">
            Instance {receipt.deploymentId}: {receipt.status} · {receipt.serviceState}
          </p>
          <p className="text-xs break-all">
            Original version: {saved?.versionId} · Transaction:{" "}
            {receipt.txHash ?? "Not prepared yet"}
          </p>
          {receipt.prepared ? (
            <p className="text-sm">
              Estimated total deployment fee, including simulated resource/storage charges:{" "}
              {formatStroops(receipt.prepared.feeStroops)} XLM ({receipt.prepared.feeStroops}{" "}
              stroops). Wallet pays. This is a simulation estimate, not a separate lifetime storage
              quote. Valid until {receipt.prepared.expiresAt}.
            </p>
          ) : null}
          {saved?.versionId !== version.id ? (
            <p role="status">
              Recovery belongs to another immutable version. Select that original version before
              signing.
            </p>
          ) : null}
          <button
            className={buttonClass}
            disabled={busy || storageError}
            onClick={() => void action(loadReview)}
          >
            Load authoritative initial review
          </button>
          {saved?.phase === "prepared" && saved.versionId === version.id && receipt.prepared ? (
            <button
              className={primaryClass}
              disabled={
                busy ||
                storageError ||
                !verifiedReview ||
                address !== saved.request.sourceAccount ||
                receipt.serviceState !== "ACTIVE"
              }
              onClick={() => void action(sign)}
            >
              Sign and submit reviewed instance
            </button>
          ) : null}
          {saved?.phase === "signing" || saved?.phase === "submitted" || saved?.phase === "held" ? (
            <p role="status">
              Signing or finality may be unknown. Reconciliation checks the original hash without
              signing or sending again. Expiry does not prove non-inclusion; unresolved submissions
              may remain held.
            </p>
          ) : null}
          <button
            className={buttonClass}
            disabled={busy || storageError}
            onClick={() => void action(reconcile)}
          >
            Check original instance status
          </button>
          {receipt.status === "CONFIRMED" ? (
            <a className="text-primary underline" href={`/deployments/${receipt.deploymentId}`}>
              View confirmed instance
            </a>
          ) : null}
          {saved?.phase === "final" &&
          (receipt.status === "CONFIRMED" || receipt.status === "FAILED") ? (
            <button
              className={buttonClass}
              disabled={busy || storageError}
              onClick={() =>
                void action(async () => {
                  const current = read();
                  if (
                    current?.receipt?.deploymentId !== receipt.deploymentId ||
                    current.phase !== "final"
                  )
                    throw new Error("Instance state changed");
                  await reconcile();
                  const verified = read();
                  if (
                    verified?.phase !== "final" ||
                    !verified.receipt ||
                    !["CONFIRMED", "FAILED"].includes(verified.receipt.status)
                  )
                    throw new Error("Finality could not be verified");
                  localStorage.removeItem(storageKey);
                  setSaved(null);
                  setPreview(null);
                  setVerifiedReview(null);
                  window.dispatchEvent(new Event("paiflow-instance-recovery"));
                })
              }
            >
              Start a separate instance after final outcome
            </button>
          ) : null}
        </div>
      ) : null}
      <button
        className={buttonClass}
        disabled={busy}
        onClick={() => void action(() => loadHistory())}
      >
        Load instance history
      </button>
      {historyLoaded && !history.length ? <p>No instances yet.</p> : null}
      <ul className="space-y-2">
        {history.map((r) => (
          <li
            key={r.deploymentId}
            className="border-outline-variant/30 space-y-1 rounded border p-3 text-sm"
          >
            <p className="break-all">
              {r.deploymentId} · {r.status} · {r.serviceState} · version {r.templateVersionId}
            </p>
            <p className="text-xs break-all">
              Source/admin: {r.sourceAccount} · {r.txHash}
            </p>
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const updated = await managementRequest(
                    `${base}/instances/${r.deploymentId}/reconcile`,
                    InstanceStateSchema,
                    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
                  );
                  assertInstanceReceipt(updated, {
                    templateId,
                    versionId: r.templateVersionId,
                    network,
                    sourceAccount: r.sourceAccount,
                    deploymentId: r.deploymentId,
                    txHash: r.txHash,
                  });
                  setHistory((old) =>
                    old.map((item) => (item.deploymentId === r.deploymentId ? updated : item)),
                  );
                })
              }
            >
              Reconcile instance {r.deploymentId}
            </button>
            {r.status === "CONFIRMED" ? (
              <a className="text-primary ml-3 underline" href={`/deployments/${r.deploymentId}`}>
                Open instance
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      {next ? (
        <button
          className={buttonClass}
          disabled={busy}
          onClick={() => void action(() => loadHistory(next))}
        >
          More instances
        </button>
      ) : null}
      {busy ? <p role="status">Waiting for the current request or wallet…</p> : null}
      {error ? (
        <div role="alert" className="text-error">
          <p>{error}</p>
          {Object.entries(fields).map(([key, messages]) => (
            <p key={key}>
              {key}: {messages.join(" ")}
            </p>
          ))}
        </div>
      ) : null}
      <p className="text-on-surface-variant text-xs">
        Paiflow never receives your private key. Signed transaction bytes are never saved in browser
        storage. Keep this original instance identity for recovery.
      </p>
    </section>
  );
}
