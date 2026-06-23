"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import ContractCallButton from "./contract-call-button";
import SubscriptionRelayerPanel from "./subscription-relayer-panel";
import type { FlowGraph } from "@/lib/flows/schema";
import { assetLabel } from "@/lib/flows/schema";
import { formatStroops } from "@/lib/utils";
import type { StellarNetwork } from "@/lib/stellar/explorer";
import type { Asset } from "@/lib/flows/schema";

type PayrollRecipient = {
  address: string;
  amount: string;
  label?: string | null;
};

export default function PayrollPanel({
  deploymentId,
  contractAddress,
  network,
  graph,
}: {
  deploymentId: string;
  contractAddress: string;
  network: StellarNetwork;
  graph: FlowGraph;
}) {
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [employer, setEmployer] = useState<string | null>(null);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [isCancelled, setIsCancelled] = useState<boolean | null>(null);
  const [recipients, setRecipients] = useState<PayrollRecipient[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deployments/${deploymentId}/payroll-allowance`)
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as {
          data: {
            allowance: string;
            employer: string;
            asset: Asset;
          };
        };
        if (!cancelled) {
          setAllowance(BigInt(json.data.allowance));
          setEmployer(json.data.employer);
          setAsset(json.data.asset);
        }
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [deploymentId, tick]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deployments/${deploymentId}/payroll-recipients`)
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as { data: { recipients: PayrollRecipient[] } };
        if (!cancelled) setRecipients(json.data.recipients);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [deploymentId, tick]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deployments/${deploymentId}/payroll-status`)
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as { data: { isCancelled: boolean } };
        if (!cancelled) setIsCancelled(json.data.isCancelled);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [deploymentId, tick]);

  const total = recipients.reduce((sum, r) => sum + BigInt(r.amount), 0n);

  return (
    <div className="mt-md space-y-md">
      <p className="text-label-sm text-on-surface-variant font-mono">
        EMPLOYER MUST APPROVE ALLOWANCE FOR RECURRING PAYROLL PULLS.
      </p>
      <div className="text-body-md space-y-3">
        {allowance !== null && asset && (
          <div>
            <div className="text-label-sm text-on-surface-variant font-mono uppercase">
              Current allowance
            </div>
            <div className="text-on-surface mt-1 font-mono text-[12px]">
              {formatStroops(allowance.toString())} {assetLabel(asset)}
            </div>
          </div>
        )}
        {employer && (
          <div>
            <div className="text-label-sm text-on-surface-variant font-mono uppercase">
              Employer
            </div>
            <div className="text-on-surface mt-1 font-mono text-[12px] break-all">{employer}</div>
          </div>
        )}
        <div>
          <div className="text-label-sm text-on-surface-variant font-mono uppercase">
            Employees ({recipients.length})
          </div>
          <div className="text-on-surface mt-1 space-y-1 font-mono text-[12px]">
            {recipients.length === 0 && (
              <span className="text-zinc-500">No recipients configured</span>
            )}
            {recipients.map((r) => (
              <div key={r.address} className="flex justify-between gap-2">
                <span className="break-all">{r.label ?? r.address}</span>
                <span>
                  {formatStroops(r.amount)} {asset ? assetLabel(asset) : ""}
                </span>
              </div>
            ))}
          </div>
          <div className="text-on-surface-variant mt-1 font-mono text-[11px]">
            Total per period: {formatStroops(total.toString())} {asset ? assetLabel(asset) : ""}
          </div>
        </div>
        <a
          href={`/payroll/${deploymentId}/employees`}
          className="border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20 inline-block rounded border px-3 py-1.5 font-mono text-xs transition-colors"
        >
          MANAGE EMPLOYEES
        </a>
      </div>

      <SubscriptionRelayerPanel deploymentId={deploymentId} network={network} />

      <div className="flex flex-wrap items-center gap-3">
        <ContractCallButton
          deploymentId={deploymentId}
          network={network}
          label="RUN PAYROLL"
          busyLabel="RUNNING…"
          icon="payments"
          variant="secondary"
          size="sm"
          prepare={async () => {
            const res = await fetch(`/api/deployments/${deploymentId}/payroll-charge`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({}),
            });
            const json = (await res.json()) as {
              data?: { unsignedXdr: string; networkPassphrase: string };
              error?: { message?: string };
            };
            if (!res.ok) throw new Error(json.error?.message ?? "Unknown error");
            const data = json.data;
            if (!data) throw new Error("Prepare failed");
            return { xdr: data.unsignedXdr, networkPassphrase: data.networkPassphrase };
          }}
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
            setTick((t) => t + 1);
            toast.success("Payroll run completed");
          }}
        />

        {isCancelled === null ? (
          <button
            disabled
            className="bg-surface-variant text-on-surface-variant inline-flex cursor-not-allowed items-center gap-1.5 rounded px-3 py-1.5 font-mono text-xs opacity-60"
          >
            <span className="material-symbols-outlined text-[16px]">sync</span>
            LOADING…
          </button>
        ) : isCancelled ? (
          <ContractCallButton
            deploymentId={deploymentId}
            network={network}
            label="SUBSCRIBE"
            busyLabel="SUBSCRIBING…"
            icon="check_circle"
            variant="secondary"
            size="sm"
            prepare={async () => {
              const res = await fetch(`/api/deployments/${deploymentId}/payroll-subscribe`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({}),
              });
              const json = (await res.json()) as {
                data?: { unsignedXdr: string; networkPassphrase: string };
                error?: { message?: string };
              };
              if (!res.ok) throw new Error(json.error?.message ?? "Unknown error");
              const data = json.data;
              if (!data) throw new Error("Prepare failed");
              return { xdr: data.unsignedXdr, networkPassphrase: data.networkPassphrase };
            }}
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
              setIsCancelled(false);
              setTick((t) => t + 1);
            }}
          />
        ) : (
          <ContractCallButton
            deploymentId={deploymentId}
            network={network}
            label="UNSUBSCRIBE"
            busyLabel="UNSUBSCRIBING…"
            icon="cancel"
            variant="danger"
            size="sm"
            prepare={async () => {
              const res = await fetch(`/api/deployments/${deploymentId}/payroll-unsubscribe`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({}),
              });
              const json = (await res.json()) as {
                data?: { unsignedXdr: string; networkPassphrase: string };
                error?: { message?: string };
              };
              if (!res.ok) throw new Error(json.error?.message ?? "Unknown error");
              const data = json.data;
              if (!data) throw new Error("Prepare failed");
              return { xdr: data.unsignedXdr, networkPassphrase: data.networkPassphrase };
            }}
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
              setIsCancelled(true);
              setAllowance(0n);
              setTick((t) => t + 1);
            }}
          />
        )}
      </div>
    </div>
  );
}
