"use client";
import { useEffect, useState } from "react";
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
}: {
  deploymentId: string;
  initial: Retirement;
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [irreversible, setIrreversible] = useState(false);
  const [onChainResponsibility, setOnChainResponsibility] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (state.serviceState !== "RETIRING") return;
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
  }, [deploymentId, router, state.serviceState]);
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
      if (json.data.serviceState === "RETIRED") router.replace("/dashboard");
      else setState(json.data);
      router.refresh();
    } catch {
      setError(
        "The request could not be confirmed. Refresh to check retirement progress before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="glass-panel mt-lg p-md rounded-xl" aria-label="Deployment retirement">
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
          <button
            className="text-error border-error rounded-lg border px-4 py-2"
            onClick={() => setConfirming(true)}
          >
            Permanently retire deployment
          </button>
          {confirming && (
            <div className="mt-4" role="group" aria-label="Confirm permanent retirement">
              <p>
                Retirement is irreversible and has no restore option. It permanently ends Paiflow
                servicing after submitted transactions and committed payouts or refunds settle.
                Unresolved payments can block completion.
              </p>
              <p className="mt-2">
                Retirement does not delete on-chain contracts, reclaim funds, revoke on-chain
                permissions, or prevent external use. Remaining on-chain funds may require direct
                interaction.
              </p>
              <label className="mt-3 flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={irreversible}
                  onChange={(event) => setIrreversible(event.target.checked)}
                  disabled={busy}
                />
                I understand this request is irreversible, cannot be cancelled, and has no restore
                option.
              </label>
              <label className="mt-3 flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={onChainResponsibility}
                  onChange={(event) => setOnChainResponsibility(event.target.checked)}
                  disabled={busy}
                />
                I understand contracts, funds, permissions, and external use remain on-chain and
                remaining funds may need direct interaction.
              </label>
              <div className="mt-4 flex gap-3">
                <button
                  disabled={busy || !irreversible || !onChainResponsibility}
                  onClick={() => void retire()}
                  className="text-error rounded border px-4 py-2"
                >
                  {busy ? "Requesting retirement…" : "Permanently retire deployment"}
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false);
                    setError(null);
                  }}
                >
                  Cancel confirmation
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
}
