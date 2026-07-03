"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import ContractCallButton from "./contract-call-button";
import type { StellarNetwork } from "@/lib/stellar/explorer";

type RelayerConfig = {
  mode: "PLATFORM" | "USER" | "MANUAL";
  relayerAddress: string | null;
  url: string | null;
  nextChargeAt: string | null;
  lastChargedAt: string | null;
  chargeEndAt: string | null;
  platformRelayerAddress: string | null;
};

export default function SubscriptionRelayerPanel({
  deploymentId,
  network,
  kind = "subscription",
}: {
  deploymentId: string;
  network: StellarNetwork;
  kind?: "subscription" | "payroll";
}) {
  const [config, setConfig] = useState<RelayerConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [mode, setMode] = useState<RelayerConfig["mode"]>("MANUAL");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [relayerAddress, setRelayerAddress] = useState("");

  const [pendingXdr, setPendingXdr] = useState<string | null>(null);
  const [pendingPassphrase, setPendingPassphrase] = useState<string | null>(null);

  const fetchConfig = async () => {
    try {
      const res = await fetch(`/api/deployments/${deploymentId}/${kind}-relayer`);
      if (!res.ok) throw new Error("Failed to load relayer config");
      const json = (await res.json()) as { data: RelayerConfig };
      setConfig(json.data);
      setMode(json.data.mode);
      setUrl(json.data.url ?? "");
      setToken(""); // never return the stored token
      setRelayerAddress(json.data.relayerAddress ?? "");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, [deploymentId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { mode };
      if (mode === "USER") {
        payload.url = url;
        payload.token = token || undefined;
        payload.relayerAddress = relayerAddress;
      }
      const res = await fetch(`/api/deployments/${deploymentId}/${kind}-relayer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        data?: {
          mode: RelayerConfig["mode"];
          relayerAddress: string | null;
          setRelayerXdr?: string;
          networkPassphrase: string;
        };
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(json.error?.message ?? "Save failed");

      if (json.data?.setRelayerXdr) {
        setPendingXdr(json.data.setRelayerXdr);
        setPendingPassphrase(json.data.networkPassphrase);
      } else {
        toast.success("Relayer configuration saved");
        setEditing(false);
        await fetchConfig();
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="text-label-sm text-on-surface-variant font-mono">
        Loading relayer settings…
      </div>
    );
  }

  if (!config) return null;

  const modeLabel =
    config.mode === "PLATFORM"
      ? "Paiflow relayer"
      : config.mode === "USER"
        ? "Your relayer"
        : "Manual";

  return (
    <div className="space-y-3">
      <div className="text-label-sm text-on-surface-variant font-mono uppercase">Charging</div>
      <div className="text-body-md text-on-surface space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-on-surface-variant font-mono text-[12px]">Mode:</span>
          <span className="font-mono text-[12px]">{modeLabel}</span>
        </div>
        {config.relayerAddress && (
          <div className="flex items-center gap-2">
            <span className="text-on-surface-variant font-mono text-[12px]">Relayer:</span>
            <span className="font-mono text-[12px] break-all">{config.relayerAddress}</span>
          </div>
        )}
        {config.nextChargeAt && (
          <div className="flex items-center gap-2">
            <span className="text-on-surface-variant font-mono text-[12px]">Next charge:</span>
            <span className="font-mono text-[12px]">
              {new Date(config.nextChargeAt).toLocaleString()}
            </span>
          </div>
        )}
        {config.lastChargedAt && (
          <div className="flex items-center gap-2">
            <span className="text-on-surface-variant font-mono text-[12px]">Last charged:</span>
            <span className="font-mono text-[12px]">
              {new Date(config.lastChargedAt).toLocaleString()}
            </span>
          </div>
        )}
        {config.chargeEndAt && (
          <div className="flex items-center gap-2">
            <span className="text-on-surface-variant font-mono text-[12px]">Ends:</span>
            <span className="font-mono text-[12px]">
              {new Date(config.chargeEndAt).toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {!editing && !pendingXdr && (
        <button
          onClick={() => setEditing(true)}
          className="border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20 rounded border px-3 py-1.5 font-mono text-xs transition-colors"
        >
          CONFIGURE RELAYER
        </button>
      )}

      {editing && !pendingXdr && (
        <div className="border-outline-variant/30 space-y-3 rounded-lg border p-3">
          <div className="space-y-1">
            <label className="text-label-sm text-on-surface-variant font-mono">Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as RelayerConfig["mode"])}
              className="border-outline-variant/40 bg-surface-container w-full rounded border px-2 py-1.5 font-mono text-xs"
            >
              <option value="MANUAL">Manual (no automatic charges)</option>
              <option value="PLATFORM">Paiflow relayer</option>
              <option value="USER">My own relayer</option>
            </select>
          </div>

          {mode === "PLATFORM" && (
            <div className="text-label-sm text-on-surface-variant font-mono">
              {config.platformRelayerAddress
                ? `Charges will be submitted by ${config.platformRelayerAddress}`
                : "Platform relayer is not configured in this environment."}
            </div>
          )}

          {mode === "USER" && (
            <>
              <div className="space-y-1">
                <label className="text-label-sm text-on-surface-variant font-mono">
                  Relayer URL
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://your-relayer.example.com/charge"
                  className="border-outline-variant/40 bg-surface-container w-full rounded border px-2 py-1.5 font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-label-sm text-on-surface-variant font-mono">
                  Auth token (optional)
                </label>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Bearer token sent to your relayer"
                  className="border-outline-variant/40 bg-surface-container w-full rounded border px-2 py-1.5 font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-label-sm text-on-surface-variant font-mono">
                  Relayer public key
                </label>
                <input
                  type="text"
                  value={relayerAddress}
                  onChange={(e) => setRelayerAddress(e.target.value)}
                  placeholder="G..."
                  className="border-outline-variant/40 bg-surface-container w-full rounded border px-2 py-1.5 font-mono text-xs"
                />
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-primary text-on-primary rounded px-3 py-1.5 font-mono text-xs font-bold transition-all hover:shadow-[0_0_24px_rgba(255,177,196,0.55)] disabled:opacity-50"
            >
              {saving ? "SAVING…" : "SAVE"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setMode(config.mode);
                setUrl(config.url ?? "");
                setRelayerAddress(config.relayerAddress ?? "");
              }}
              disabled={saving}
              className="border-outline-variant/40 bg-surface-container text-on-surface hover:bg-surface-container-high rounded border px-3 py-1.5 font-mono text-xs transition-colors disabled:opacity-50"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {pendingXdr && pendingPassphrase && (
        <div className="border-outline-variant/30 space-y-3 rounded-lg border p-3">
          <p className="text-body-md text-on-surface">
            The relayer address changed. Sign the on-chain update to activate it.
          </p>
          <ContractCallButton
            deploymentId={deploymentId}
            network={network}
            label="CONFIRM ON-CHAIN RELAYER"
            busyLabel="CONFIRMING…"
            icon="verified"
            variant="primary"
            size="sm"
            prepare={async () => ({ xdr: pendingXdr, networkPassphrase: pendingPassphrase })}
            submit={async (signedXdr) => {
              const res = await fetch(`/api/deployments/${deploymentId}/submit-invoke`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ signedXdr }),
              });
              const json = (await res.json()) as { data: { txHash: string } };
              if (!res.ok) throw new Error("Submit failed");
              return { txHash: json.data.txHash };
            }}
            onSuccess={() => {
              setPendingXdr(null);
              setPendingPassphrase(null);
              setEditing(false);
              fetchConfig();
            }}
          />
          <button
            onClick={() => {
              setPendingXdr(null);
              setPendingPassphrase(null);
            }}
            className="border-outline-variant/40 bg-surface-container text-on-surface hover:bg-surface-container-high rounded border px-3 py-1.5 font-mono text-xs transition-colors"
          >
            CANCEL
          </button>
        </div>
      )}
    </div>
  );
}
