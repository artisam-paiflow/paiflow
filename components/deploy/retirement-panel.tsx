"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RetireDeploymentSchema } from "@/lib/deployments/service-schema";

type Retirement = {
  serviceState: string;
  retirementBlocker: string | null;
  retirementCutoffLedger?: number | null;
  retirementReconciledAt?: string | null;
};
export default function RetirementPanel({
  deploymentId,
  initial,
  displayMode = "panel",
  flowName,
}: {
  deploymentId: string;
  initial: Retirement;
  displayMode?: "panel" | "icon" | "button";
  flowName?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [irreversible, setIrreversible] = useState(false);
  const [onChainResponsibility, setOnChainResponsibility] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (displayMode === "panel") return;
    if (confirming) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [confirming, displayMode]);
  useEffect(() => {
    if (state.serviceState !== "RETIRING") return;
    if (displayMode !== "panel" && !confirming) return;
    const timer = setInterval(() => {
      void fetch(`/api/deployments/${deploymentId}/retirement`)
        .then(async (response) => {
          if (response.status === 404) {
            router.replace("/dashboard");
            router.refresh();
            return;
          }
          if (response.ok) setState((await response.json()).data);
        })
        .catch(() => setError("Retirement progress is temporarily unavailable."));
    }, 5000);
    return () => clearInterval(timer);
  }, [confirming, deploymentId, displayMode, router, state.serviceState]);
  async function retire() {
    const body = RetireDeploymentSchema.safeParse({
      confirmation: "Permanently retire deployment",
      irreversible,
      onChainResponsibility,
    });
    if (!body.success) {
      setError("Confirm both statements before permanently retiring this deployment.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/deployments/${deploymentId}/retirement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body.data),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json.error?.message ?? "Retirement request failed.");
        return;
      }
      toast.success(
        json.data.serviceState === "RETIRED"
          ? "Deployment permanently retired"
          : "Retirement requested; settlement is in progress",
      );
      if (json.data.serviceState === "RETIRED") {
        setConfirming(false);
        router.replace("/dashboard");
      } else setState(json.data);
      router.refresh();
    } catch {
      setError(
        "The request could not be confirmed. Refresh to check retirement progress before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  const content = (
    <section
      className={displayMode === "panel" ? "glass-panel mt-lg p-md rounded-xl" : "text-body-sm p-6"}
      aria-label="Deployment retirement"
    >
      {state.serviceState === "RETIRING" ? (
        <>
          <h2 className="text-headline-sm">Retirement in progress</h2>
          <p className="mt-2">
            New execution and future automation are closed. Paiflow is settling committed work. This
            request cannot be cancelled or restored.
          </p>
          <p className="mt-2" role="status">
            {state.retirementBlocker ?? "Checking settlement"}
          </p>
          {state.retirementCutoffLedger != null && (
            <p className="mt-2">
              Event cutoff: ledger {state.retirementCutoffLedger}.{" "}
              {state.retirementReconciledAt
                ? "Coverage reconciled."
                : "Coverage reconciliation pending."}
            </p>
          )}
        </>
      ) : (
        <>
          {displayMode === "panel" && (
            <button
              className="text-error border-error rounded-lg border px-4 py-2"
              onClick={() => setConfirming(true)}
            >
              Permanently retire deployment
            </button>
          )}
          {confirming && (
            <div
              className={displayMode === "panel" ? "mt-4" : ""}
              role="group"
              aria-label="Confirm permanent retirement"
            >
              {displayMode !== "panel" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="border-outline-variant/20 bg-surface-container/50 rounded-xl border p-4">
                    <h3 className="text-on-surface text-label-md font-semibold">
                      Automation stops
                    </h3>
                    <p className="text-on-surface-variant mt-2 leading-relaxed">
                      Paiflow stops new runs. Pending transactions, payouts, and refunds must
                      settle; unresolved payments can block retirement.
                    </p>
                  </div>
                  <div className="border-outline-variant/20 bg-surface-container/50 rounded-xl border p-4">
                    <h3 className="text-on-surface text-label-md font-semibold">
                      On-chain assets remain
                    </h3>
                    <p className="text-on-surface-variant mt-2 leading-relaxed">
                      Contracts, funds, permissions, and external use remain. Funds aren’t reclaimed
                      and may need direct on-chain access.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <p>
                    Retirement is irreversible and has no restore option. It permanently ends
                    Paiflow servicing after submitted transactions and committed payouts or refunds
                    settle. Unresolved payments can block completion.
                  </p>
                  <p className="mt-2">
                    Retirement does not delete on-chain contracts, reclaim funds, revoke on-chain
                    permissions, or prevent external use. Remaining on-chain funds may require
                    direct interaction.
                  </p>
                </>
              )}
              {displayMode !== "panel" && (
                <p className="text-label-sm text-on-surface-variant mt-6 mb-3 font-mono">
                  CONFIRM TO CONTINUE
                </p>
              )}
              <label
                className={
                  displayMode === "panel"
                    ? "mt-3 flex items-start gap-2"
                    : "flex cursor-pointer items-start gap-3"
                }
              >
                <input
                  type="checkbox"
                  className={
                    displayMode !== "panel" ? "accent-error mt-0.5 h-4 w-4 shrink-0" : undefined
                  }
                  checked={irreversible}
                  onChange={(event) => setIrreversible(event.target.checked)}
                  disabled={busy}
                />
                {displayMode !== "panel" ? (
                  <span>I understand this cannot be cancelled or restored.</span>
                ) : (
                  "I understand this request is irreversible, cannot be cancelled, and has no restore option."
                )}
              </label>
              <label
                className={
                  displayMode === "panel"
                    ? "mt-3 flex items-start gap-2"
                    : "mt-3 flex cursor-pointer items-start gap-3"
                }
              >
                <input
                  type="checkbox"
                  className={
                    displayMode !== "panel" ? "accent-error mt-0.5 h-4 w-4 shrink-0" : undefined
                  }
                  checked={onChainResponsibility}
                  onChange={(event) => setOnChainResponsibility(event.target.checked)}
                  disabled={busy}
                />
                {displayMode !== "panel" ? (
                  <span>I’m responsible for remaining on-chain assets and permissions.</span>
                ) : (
                  "I understand contracts, funds, permissions, and external use remain on-chain and remaining funds may need direct interaction."
                )}
              </label>
              <div
                className={
                  displayMode === "panel"
                    ? "mt-4 flex gap-3"
                    : "border-outline-variant/20 mt-6 flex flex-wrap justify-end gap-3 border-t pt-5"
                }
              >
                <button
                  disabled={busy || !irreversible || !onChainResponsibility}
                  onClick={() => void retire()}
                  className={
                    displayMode === "panel"
                      ? "text-error rounded border px-4 py-2"
                      : "bg-error text-on-error text-label-sm rounded-lg px-4 py-2.5 font-mono font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                  }
                >
                  {busy
                    ? "Requesting retirement…"
                    : displayMode !== "panel"
                      ? "Retire deployment"
                      : "Permanently retire deployment"}
                </button>
                <button
                  className={
                    displayMode !== "panel"
                      ? "border-outline-variant/40 text-label-sm hover:bg-surface-container-high rounded-lg border px-4 py-2.5 font-mono font-semibold disabled:opacity-40"
                      : undefined
                  }
                  autoFocus={displayMode !== "panel"}
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false);
                    setError(null);
                  }}
                >
                  {displayMode !== "panel" ? "Cancel" : "Cancel confirmation"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-error mt-3">
          {error}
        </p>
      )}
    </section>
  );
  if (displayMode === "panel") return content;
  return (
    <>
      <button
        type="button"
        aria-label={`Retire deployment${flowName ? ` for ${flowName}` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={confirming}
        title={state.serviceState === "RETIRING" ? "Retirement in progress" : "Retire deployment"}
        disabled={busy || state.serviceState !== "ACTIVE"}
        className={
          displayMode === "button"
            ? "border-error/40 bg-error/10 text-error hover:bg-error/20 focus-visible:ring-error text-label-sm inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 font-mono font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            : "text-on-surface-variant hover:text-error hover:bg-error/10 focus-visible:ring-error inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
        }
        onClick={() => {
          setError(null);
          setIrreversible(false);
          setOnChainResponsibility(false);
          setConfirming(true);
        }}
      >
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
          delete
        </span>
        {displayMode === "button" && "Retire deployment"}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`retire-title-${deploymentId}`}
        className="bg-surface-container-low text-on-surface border-outline-variant/30 fixed inset-0 m-auto max-h-[calc(100vh_-_2rem)] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-2xl border p-0 shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm"
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
        onClose={() => {
          setConfirming(false);
          setError(null);
          setIrreversible(false);
          setOnChainResponsibility(false);
        }}
      >
        <div className="border-outline-variant/20 relative border-b px-6 pt-6 pb-4">
          <button
            type="button"
            aria-label="Close retirement confirmation"
            disabled={busy}
            className="text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high focus-visible:ring-primary absolute top-4 right-4 inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40"
            onClick={() => setConfirming(false)}
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
              close
            </span>
          </button>
          <h2
            id={`retire-title-${deploymentId}`}
            className="font-display pr-8 text-[24px] font-semibold"
          >
            Retire deployment?
          </h2>
          {flowName && <p className="text-on-surface-variant mt-1 break-words">{flowName}</p>}
        </div>
        {content}
      </dialog>
    </>
  );
}
