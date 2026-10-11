"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DeleteFlowSchema } from "@/lib/deployments/service-schema";

export default function DeleteFlowButton({
  flowId,
  flowName,
  hasDeployments,
}: {
  flowId: string;
  flowName: string;
  hasDeployments: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (confirming) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirming]);
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/flows/${flowId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(DeleteFlowSchema.parse({ confirmation: "Permanently delete flow" })),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json.error?.message ?? "Flow deletion failed.");
        return;
      }
      toast.success("Flow permanently deleted");
      setConfirming(false);
      router.refresh();
    } catch {
      setError("Unable to delete the flow. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        disabled={hasDeployments || busy}
        aria-label="Delete flow"
        aria-expanded={confirming}
        aria-haspopup="dialog"
        title={
          hasDeployments ? "Flows with deployments cannot be permanently deleted." : "Delete flow"
        }
        className="top-md right-md text-on-surface-variant hover:text-error hover:bg-error/10 focus-visible:ring-error absolute -mt-2 -mr-2 inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
      >
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
          delete
        </span>
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`delete-flow-title-${flowId}`}
        aria-describedby={`delete-flow-description-${flowId}`}
        className="bg-surface-container-low text-on-surface border-outline-variant/30 fixed inset-0 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-2xl border p-0 shadow-[0_24px_80px_rgba(0,0,0,0.6)] backdrop:bg-black/70 backdrop:backdrop-blur-sm"
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
        onClose={() => {
          setConfirming(false);
          setError(null);
        }}
      >
        <div className="relative p-6 sm:p-8">
          <button
            type="button"
            aria-label="Close deletion confirmation"
            disabled={busy}
            className="text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus-visible:ring-primary absolute top-4 right-4 inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40"
            onClick={() => setConfirming(false)}
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
              close
            </span>
          </button>
          <h2
            id={`delete-flow-title-${flowId}`}
            className="font-display pr-8 text-[24px] leading-tight font-semibold tracking-tight"
          >
            Delete this flow?
          </h2>
          <p
            id={`delete-flow-description-${flowId}`}
            className="text-body-md text-on-surface-variant mt-3 leading-relaxed"
          >
            <span className="text-on-surface font-medium break-words">“{flowName}”</span> will be
            permanently deleted. You won’t be able to restore it.
          </p>
          {error && (
            <p
              role="alert"
              className="border-error/20 bg-error/10 text-error text-body-sm mt-4 rounded-lg border px-3 py-2"
            >
              {error}
            </p>
          )}
        </div>
        <div className="border-outline-variant/20 bg-surface-container/50 flex flex-wrap justify-end gap-3 border-t px-6 py-4 sm:px-8">
          <button
            type="button"
            className="bg-error text-on-error text-label-md focus-visible:ring-error hover:bg-error/90 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-5 py-2.5 font-mono font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            disabled={busy}
            onClick={() => void remove()}
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              delete
            </span>
            {busy ? "Deleting…" : "Delete flow"}
          </button>
          <button
            type="button"
            className="border-outline-variant/40 text-on-surface text-label-md hover:bg-surface-container-high focus-visible:ring-primary inline-flex min-h-10 items-center justify-center rounded-lg border px-5 py-2.5 font-mono font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            autoFocus
            disabled={busy}
            onClick={() => {
              setConfirming(false);
              setError(null);
            }}
          >
            Cancel
          </button>
        </div>
      </dialog>
    </>
  );
}
