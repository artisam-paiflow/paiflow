"use client";
import { useState } from "react";
import { toast } from "sonner";
import { HostedVisibilitySchema } from "@/lib/hosted-execution/schema";

export default function HostedExecutionPanel({
  deploymentId,
  initialEnabled,
}: {
  deploymentId: string;
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const input = HostedVisibilitySchema.parse({ enabled: !enabled });
      const response = await fetch(`/api/deployments/${deploymentId}/hosted-execution`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not update the payment form");
      setEnabled(HostedVisibilitySchema.parse(body.data).enabled);
      toast.success(input.enabled ? "Hosted payment form enabled" : "Hosted payment form disabled");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the payment form");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="glass-panel p-md mt-md space-y-3 rounded-xl"
      aria-label="Hosted payment form"
    >
      <h2 className="text-title-md">Hosted payment form</h2>
      <p className="text-on-surface-variant text-sm">
        Let wallet holders supply this deployment’s declared payment inputs without a Paiflow
        account. Disabling this form does not restrict direct contract calls or erase pending
        payments.
      </p>
      <button type="button" onClick={toggle} disabled={busy} className="btn-secondary">
        {busy ? "Saving…" : enabled ? "Disable payment form" : "Enable payment form"}
      </button>
      {enabled && (
        <a href={`/trigger/${deploymentId}`} className="text-primary ml-3 underline">
          Open payment form
        </a>
      )}
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
    </section>
  );
}
