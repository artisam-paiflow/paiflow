"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { StrKey } from "@stellar/stellar-sdk";
import { formatStroops, formatAmount } from "@/lib/utils";
import type { Asset } from "@/lib/flows/schema";
import { assetLabel } from "@/lib/flows/schema";

type Employee = {
  address: string;
  amount: string;
  label?: string;
};

export default function EmployeeManager({
  deploymentId,
  asset,
}: {
  deploymentId: string;
  asset: Asset;
}) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/deployments/${deploymentId}/payroll-recipients`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load employees");
        const json = (await res.json()) as { data: { recipients: Employee[] } };
        setEmployees(json.data.recipients.map((r) => ({ ...r, label: r.label ?? "" })));
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [deploymentId]);

  const total = employees.reduce((sum, e) => sum + BigInt(e.amount || "0"), 0n);

  const updateEmployee = (index: number, patch: Partial<Employee>) => {
    setEmployees((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  };

  const addEmployee = () => {
    setEmployees((prev) => [...prev, { address: "", amount: "", label: "" }]);
  };

  const removeEmployee = (index: number) => {
    setEmployees((prev) => prev.filter((_, i) => i !== index));
  };

  const validate = (): boolean => {
    for (const e of employees) {
      if (!StrKey.isValidEd25519PublicKey(e.address)) {
        toast.error(`Invalid address: ${e.address || "empty"}`);
        return false;
      }
      if (!/^\d+$/.test(e.amount) || e.amount === "0") {
        toast.error(`Invalid amount for ${e.address || "employee"}`);
        return false;
      }
    }
    if (employees.length === 0) {
      toast.error("At least one employee is required");
      return false;
    }
    return true;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/deployments/${deploymentId}/payroll-update-recipients`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipients: employees.map((e) => ({
            address: e.address,
            amount: e.amount,
            label: e.label || undefined,
          })),
        }),
      });
      const json = (await res.json()) as {
        data?: { unsignedXdr: string; networkPassphrase: string };
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(json.error?.message ?? "Failed to prepare update");

      const { kit } = await import("@/components/deploy/wallet-kit").then((m) =>
        m.getWalletKit("testnet"),
      );
      await kit.openModal({
        onWalletSelected: async (wallet: { id: string; name: string }) => {
          kit.setWallet(wallet.id);
          const { address } = await kit.getAddress();
          const { signedTxXdr } = await kit.signTransaction(json.data!.unsignedXdr, {
            address,
            networkPassphrase: json.data!.networkPassphrase,
          });
          const submitRes = await fetch(`/api/deployments/${deploymentId}/submit-invoke`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ signedXdr: signedTxXdr }),
          });
          if (!submitRes.ok) throw new Error("Submit failed");
          toast.success("Employees updated on-chain");
        },
        onClosed: () => {
          toast.warning("Update cancelled");
        },
      });
    } catch (err) {
      toast.error((err as Error).message ?? "Update failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="text-on-surface-variant py-8 text-center font-mono text-sm">Loading…</div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-400">
        Employees are stored on-chain in the payroll contract. Updating the list requires signing a
        transaction.
      </div>

      <div className="space-y-2">
        {employees.map((e, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_1fr_120px_40px] gap-2 rounded border border-zinc-800 bg-zinc-950 p-3"
          >
            <input
              className="input"
              placeholder="Label (optional)"
              value={e.label}
              onChange={(ev) => updateEmployee(i, { label: ev.target.value })}
            />
            <input
              className="input font-mono"
              placeholder="G… address"
              value={e.address}
              onChange={(ev) => updateEmployee(i, { address: ev.target.value })}
            />
            <input
              className="input font-mono"
              placeholder="Amount"
              value={e.amount ? formatAmount(e.amount) : ""}
              onChange={(ev) => {
                const raw = ev.target.value.replace(/[^0-9.]/g, "");
                const parts = raw.split(".");
                const whole = parts[0] ?? "0";
                const frac = (parts[1] ?? "").slice(0, 7).padEnd(7, "0");
                const stroops = `${whole}${frac}`.replace(/^0+/, "") || "0";
                updateEmployee(i, { amount: stroops });
              }}
            />
            <button
              type="button"
              onClick={() => removeEmployee(i)}
              className="text-red-400 hover:text-red-300"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={addEmployee}
          className="border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20 rounded border px-3 py-1.5 font-mono text-xs"
        >
          + ADD EMPLOYEE
        </button>
        <div className="text-on-surface font-mono text-sm">
          Total: {formatStroops(total.toString())} {assetLabel(asset)}
        </div>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="bg-primary text-on-primary hover:shadow-primary/50 w-full rounded-lg py-2.5 font-mono font-bold transition-shadow disabled:opacity-50"
      >
        {saving ? "SAVING…" : "SAVE EMPLOYEES"}
      </button>
    </div>
  );
}
