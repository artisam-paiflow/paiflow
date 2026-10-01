"use client";

import { useState } from "react";
import { toast } from "sonner";
import { apiError } from "@/lib/friendly-error";
import { toastError } from "@/lib/friendly-toast";
import type { StellarNetwork } from "@/lib/stellar/explorer";

/**
 * "Release now" for a timelock branch (#751): pays its before side ahead of the
 * deadline through the relayer. Two steps (a click, then a confirmation that
 * names the network) because a release cannot be undone.
 */
export default function ReleaseNowPanel({
  deploymentId,
  network,
  nodeIds,
}: {
  deploymentId: string;
  network: StellarNetwork;
  nodeIds: string[];
}) {
  const [nodeId, setNodeId] = useState(nodeIds[0] ?? "");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const isMainnet = network === "mainnet";
  const chipClass = isMainnet
    ? "border-error/40 bg-error-container/30 text-error"
    : "border-secondary/30 bg-secondary/10 text-secondary";

  async function release() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deployments/${deploymentId}/release-early`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(nodeIds.length > 1 ? { nodeId } : {}),
      });
      const json = (await res.json().catch(() => null)) as {
        data?: { txHash: string };
      } | null;
      if (!res.ok || !json?.data) throw apiError(json, "Release failed");
      setTxHash(json.data.txHash);
      setConfirming(false);
      toast.success("Released to the before side");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Release failed");
      toastError(err, "Release failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-panel mt-md p-md space-y-3 rounded-xl" data-testid="release-now-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-label-sm text-on-surface-variant font-mono uppercase">/ RELEASE NOW</p>
          <p className="text-on-surface-variant mt-1 font-mono text-xs">
            Pay the before side now, ahead of the deadline. After the deadline this condition
            releases to its after side by itself.
          </p>
        </div>
        <span
          className={`text-label-md inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono ${chipClass}`}
          aria-label={`Releasing on ${network}`}
          data-testid="network-chip"
        >
          {network.toUpperCase()}
        </span>
      </div>

      {nodeIds.length > 1 && (
        <label className="grid gap-1">
          <span className="text-label-sm text-on-surface-variant font-mono uppercase">
            Timelock branch
          </span>
          <select
            value={nodeId}
            onChange={(e) => setNodeId(e.target.value)}
            disabled={busy}
            className="border-outline-variant/40 bg-surface-container-lowest text-on-surface rounded border px-3 py-2 font-mono text-[14px]"
          >
            {nodeIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}
      {txHash && (
        <p className="text-label-sm text-on-surface-variant font-mono break-all">
          RELEASED · TX {txHash}
        </p>
      )}

      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body-sm text-on-surface">
            Release to the before side on {network.toUpperCase()}? This cannot be undone.
          </span>
          <button
            type="button"
            onClick={release}
            disabled={busy}
            className="bg-primary text-on-primary text-label-md rounded px-3 py-1.5 font-mono disabled:opacity-60"
          >
            {busy ? "RELEASING…" : "CONFIRM RELEASE"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="text-label-md text-on-surface-variant rounded px-3 py-1.5 font-mono"
          >
            CANCEL
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          className="border-primary/40 text-primary text-label-md rounded border px-3 py-1.5 font-mono"
        >
          RELEASE NOW
        </button>
      )}
    </div>
  );
}
