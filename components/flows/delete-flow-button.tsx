"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DeleteFlowSchema } from "@/lib/deployments/service-schema";

export default function DeleteFlowButton({
  flowId,
  hasDeployments,
}: {
  flowId: string;
  hasDeployments: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      router.refresh();
    } catch {
      setError("Unable to delete the flow. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="px-md pb-md">
      {hasDeployments ? (
        <p className="text-label-sm text-on-surface-variant">
          Flows with deployments cannot be permanently deleted.
        </p>
      ) : (
        <>
          <button className="text-error text-label-sm" onClick={() => setConfirming(true)}>
            Permanently delete flow
          </button>
          {confirming && (
            <div className="mt-2" role="group" aria-label="Confirm permanent flow deletion">
              <p>This permanently deletes the unused flow. There is no undo.</p>
              <div className="mt-2 flex gap-3">
                <button disabled={busy} onClick={() => void remove()}>
                  {busy ? "Deleting…" : "Confirm permanent deletion"}
                </button>
                <button disabled={busy} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-error mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
