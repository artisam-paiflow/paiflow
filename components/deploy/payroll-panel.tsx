"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import ContractCallButton from "./contract-call-button";
import SubscriptionRelayerPanel from "./subscription-relayer-panel";
import OffRampSenderForm from "@/components/payroll/offramp-sender-form";
import type { FlowGraph } from "@/lib/flows/schema";
import { assetLabel, tokenAmountToStroops } from "@/lib/flows/schema";
import { formatStroops } from "@/lib/utils";
import type { StellarNetwork } from "@/lib/stellar/explorer";
import type { Asset } from "@/lib/flows/schema";

type PayrollRecipient = {
  address: string;
  amount: string;
  label?: string | null;
};

type BankDetail = {
  accountName: string;
  accountNumber: string;
  bankCode: string;
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
  const [allowanceAmount, setAllowanceAmount] = useState("");
  const [employer, setEmployer] = useState<string | null>(null);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [isCancelled, setIsCancelled] = useState<boolean | null>(null);
  const [recipients, setRecipients] = useState<PayrollRecipient[]>([]);
  const [offRampEnabled, setOffRampEnabled] = useState<boolean | null>(null);
  const [bankDetails, setBankDetails] = useState<Record<string, BankDetail | null>>({});
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

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deployments/${deploymentId}/offramp-enable`)
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as { data: { offRampEnabled: boolean } };
        if (!cancelled) setOffRampEnabled(json.data.offRampEnabled);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [deploymentId, tick]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deployments/${deploymentId}/employees/bank`)
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as {
          data: Array<{ address: string; bankDetail: BankDetail | null }>;
        };
        if (!cancelled) {
          const map: Record<string, BankDetail | null> = {};
          for (const item of json.data) {
            map[item.address] = item.bankDetail;
          }
          setBankDetails(map);
        }
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [deploymentId, tick]);

  const total = recipients.reduce((sum, r) => sum + BigInt(r.amount), 0n);

  const toggleOffRamp = async () => {
    const next = !offRampEnabled;
    const res = await fetch(`/api/deployments/${deploymentId}/offramp-enable`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    if (!res.ok) {
      toast.error("Failed to update off-ramp setting");
      return;
    }
    setOffRampEnabled(next);
    toast.success(next ? "Fiat off-ramp enabled" : "Fiat off-ramp disabled");
  };

  const fiatCount = recipients.filter((r) => bankDetails[r.address]).length;

  return (
    <div className="mt-md space-y-md">
      <p className="text-label-sm text-on-surface-variant font-mono">
        EMPLOYER MUST APPROVE ALLOWANCE FOR RECURRING PAYROLL PULLS.
      </p>
      <div className="text-body-md space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-4">
          {allowance !== null && asset ? (
            <div>
              <div className="text-label-sm text-on-surface-variant font-mono uppercase">
                Current allowance
              </div>
              <div className="text-on-surface mt-1 font-mono text-[12px]">
                {formatStroops(allowance.toString())} {assetLabel(asset)}
              </div>
            </div>
          ) : (
            <span className="text-on-surface-variant font-mono text-xs">Loading allowance…</span>
          )}

          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              placeholder="Amount"
              value={allowanceAmount}
              onChange={(e) => setAllowanceAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              className="border-outline-variant/40 bg-surface-container w-28 rounded border px-2 py-1.5 font-mono text-xs"
            />
            <ContractCallButton
              deploymentId={deploymentId}
              network={network}
              label="GRANT ALLOWANCE"
              busyLabel="GRANTING…"
              icon="lock_open"
              variant="secondary"
              size="sm"
              className="!py-1 !text-xs"
              prepare={async () => {
                const amount = allowanceAmount.trim();
                if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
                  throw new Error("Enter a positive amount to approve");
                }
                const res = await fetch(`/api/deployments/${deploymentId}/payroll-allowance`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ amount: tokenAmountToStroops(amount) }),
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
                setAllowanceAmount("");
                setTick((t) => t + 1);
                toast.success("Allowance granted");
              }}
            />
          </div>
        </div>

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
                <span className="flex items-center gap-1.5 break-all">
                  {bankDetails[r.address] && (
                    <span className="material-symbols-outlined text-on-surface-variant text-[14px]">
                      account_balance
                    </span>
                  )}
                  {r.label ?? r.address}
                </span>
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

        <div className="space-y-3 rounded border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-label-sm text-on-surface font-mono uppercase">Fiat off-ramp</div>
              <div className="text-on-surface-variant mt-0.5 font-mono text-[11px]">
                {fiatCount} of {recipients.length} employees configured for fiat payout
              </div>
            </div>
            {offRampEnabled === null ? (
              <span className="text-on-surface-variant font-mono text-xs">Loading…</span>
            ) : (
              <button
                type="button"
                onClick={toggleOffRamp}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  offRampEnabled ? "bg-primary" : "bg-zinc-700"
                }`}
                aria-pressed={offRampEnabled}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    offRampEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            )}
          </div>

          {offRampEnabled && <OffRampSenderForm deploymentId={deploymentId} />}
        </div>
      </div>

      {/* Hidden for now — dev payroll always uses the platform relayer.
      <SubscriptionRelayerPanel deploymentId={deploymentId} network={network} kind="payroll" />
      */}

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

            // Book-keep the manual charge so off-ramp jobs can be created.
            const recordRes = await fetch(`/api/deployments/${deploymentId}/payroll-record-run`, {
              method: "POST",
              headers: { "content-type": "application/json" },
            });
            const recordJson = (await recordRes.json()) as {
              data?: { offRampJobIds?: string[]; offRampError?: string };
              error?: { message?: string };
            };
            if (!recordRes.ok) {
              console.warn("Failed to record payroll run:", recordJson.error?.message);
            } else if (recordJson.data?.offRampError) {
              console.warn("Off-ramp job creation failed:", recordJson.data.offRampError);
            }

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
