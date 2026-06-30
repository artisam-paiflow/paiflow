"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { StrKey } from "@stellar/stellar-sdk";
import { formatStroops, formatAmount } from "@/lib/utils";
import type { Asset } from "@/lib/flows/schema";
import { assetLabel } from "@/lib/flows/schema";
import { usePollTxStatus } from "@/lib/hooks/use-poll-tx-status";

type Employee = {
  address: string;
  amount: string;
  label?: string;
  payoutMode?: "crypto" | "fiat";
};

type BankDetail = {
  accountName: string;
  accountNumber: string;
  bankCode: string;
};

export default function EmployeeManager({
  deploymentId,
  asset,
}: {
  deploymentId: string;
  asset: Asset;
}) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [bankDetails, setBankDetails] = useState<Record<string, BankDetail | null>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingBanks, setSavingBanks] = useState(false);
  const pollTxStatus = usePollTxStatus();

  useEffect(() => {
    Promise.all([
      fetch(`/api/deployments/${deploymentId}/payroll-recipients`).then(async (res) => {
        if (!res.ok) throw new Error("Failed to load employees");
        const json = (await res.json()) as {
          data: {
            recipients: Array<{
              address: string;
              amount: string;
              label?: string;
              payoutMode?: "crypto" | "fiat";
            }>;
          };
        };
        return json.data.recipients.map((r) => ({
          ...r,
          label: r.label ?? "",
          payoutMode: r.payoutMode ?? "crypto",
        }));
      }),
      fetch(`/api/deployments/${deploymentId}/employees/bank`).then(async (res) => {
        if (!res.ok) throw new Error("Failed to load bank details");
        const json = (await res.json()) as {
          data: Array<{
            address: string;
            bankDetail: BankDetail | null;
            payoutMode?: "crypto" | "fiat";
            cashOutContractAddress?: string | null;
          }>;
        };
        const map: Record<string, BankDetail | null> = {};
        for (const item of json.data) {
          map[item.address] = item.bankDetail;
        }
        return map;
      }),
    ])
      .then(([emps, banks]) => {
        setEmployees(emps);
        setBankDetails(banks);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [deploymentId]);

  const total = employees.reduce((sum, e) => sum + BigInt(e.amount || "0"), 0n);

  const updateEmployee = (index: number, patch: Partial<Employee>) => {
    setEmployees((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  };

  const updatePayoutMode = (index: number, mode: "crypto" | "fiat") => {
    setEmployees((prev) => prev.map((e, i) => (i === index ? { ...e, payoutMode: mode } : e)));
  };

  const updateBankDetail = (address: string, patch: Partial<BankDetail>) => {
    setBankDetails((prev) => {
      const current = prev[address] ?? { accountName: "", accountNumber: "", bankCode: "" };
      return { ...prev, [address]: { ...current, ...patch } };
    });
  };

  const addEmployee = () => {
    setEmployees((prev) => [...prev, { address: "", amount: "", label: "" }]);
  };

  const removeEmployee = (index: number) => {
    const address = employees[index]?.address;
    setEmployees((prev) => prev.filter((_, i) => i !== index));
    if (address) {
      setBankDetails((prev) => {
        const next = { ...prev };
        delete next[address];
        return next;
      });
    }
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
            payoutMode: e.payoutMode ?? "crypto",
            bankDetail: bankDetails[e.address] ?? undefined,
          })),
        }),
      });
      const json = (await res.json()) as {
        data?: {
          unsignedXdr?: string;
          networkPassphrase?: string;
          txHash?: string;
          txHashes?: string[];
        };
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(json.error?.message ?? "Failed to prepare update");
      const data = json.data;
      if (!data) throw new Error("Prepare failed");

      if (data.txHashes) {
        toast.info("Transactions submitted. Waiting for confirmation...");
        const results = await Promise.all(
          data.txHashes.map((txHash) => pollTxStatus(deploymentId, txHash)),
        );
        const failed = results.find((r) => r.status === "FAILED");
        if (failed) {
          throw new Error(failed.errorMessage ?? "Transaction failed on the network");
        }
        toast.success("Employees updated on-chain");
        return;
      }

      if (data.txHash) {
        toast.success("Employees updated on-chain");
        return;
      }

      if (!data.unsignedXdr || !data.networkPassphrase) {
        throw new Error("Missing transaction payload");
      }

      const { kit } = await import("@/components/deploy/wallet-kit").then((m) =>
        m.getWalletKit("testnet"),
      );
      await kit.openModal({
        onWalletSelected: async (wallet: { id: string; name: string }) => {
          kit.setWallet(wallet.id);
          const { address } = await kit.getAddress();
          const { signedTxXdr } = await kit.signTransaction(data.unsignedXdr, {
            address,
            networkPassphrase: data.networkPassphrase,
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

  const saveBankDetails = async () => {
    setSavingBanks(true);
    try {
      for (const e of employees) {
        const bank = bankDetails[e.address];
        if (!bank) continue;
        const hasValue =
          bank.accountName.trim() || bank.accountNumber.trim() || bank.bankCode.trim();
        if (!hasValue) continue;

        if (!bank.accountName.trim() || !bank.accountNumber.trim() || !bank.bankCode.trim()) {
          toast.error(`Complete all bank fields for ${e.address || "employee"}`);
          return;
        }

        const res = await fetch(`/api/deployments/${deploymentId}/employees/bank`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            address: e.address,
            accountName: bank.accountName.trim(),
            accountNumber: bank.accountNumber.trim(),
            bankCode: bank.bankCode.trim(),
          }),
        });
        if (!res.ok) {
          const json = (await res.json()) as { error?: { message?: string } };
          throw new Error(json.error?.message ?? `Failed to save bank details for ${e.address}`);
        }
      }
      toast.success("Bank details saved");
    } catch (err) {
      toast.error((err as Error).message ?? "Bank details save failed");
    } finally {
      setSavingBanks(false);
    }
  };

  if (loading) {
    return (
      <div className="text-on-surface-variant py-8 text-center font-mono text-sm">Loading…</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-400">
        Employees are stored on-chain in the payroll contract. Updating the list requires signing a
        transaction.
      </div>

      <div className="space-y-3">
        {employees.map((e, i) => {
          const bank = bankDetails[e.address] ?? {
            accountName: "",
            accountNumber: "",
            bankCode: "",
          };
          const fiatEnabled = Boolean(
            bank.accountName.trim() || bank.accountNumber.trim() || bank.bankCode.trim(),
          );

          const isFiat = e.payoutMode === "fiat";

          return (
            <div key={i} className="space-y-2 rounded border border-zinc-800 bg-zinc-950 p-3">
              <div className="grid grid-cols-[1fr_1fr_120px_40px] gap-2">
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
                  onChange={(ev) => {
                    const oldAddress = e.address;
                    const newAddress = ev.target.value;
                    updateEmployee(i, { address: newAddress });
                    setBankDetails((prev) => {
                      const next = { ...prev };
                      if (next[oldAddress]) {
                        next[newAddress] = next[oldAddress];
                        delete next[oldAddress];
                      }
                      return next;
                    });
                  }}
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

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-on-surface-variant text-[16px]">
                    account_balance
                  </span>
                  <select
                    className="input bg-surface-container text-xs"
                    value={e.payoutMode ?? "crypto"}
                    onChange={(ev) => updatePayoutMode(i, ev.target.value as "crypto" | "fiat")}
                  >
                    <option value="crypto">Crypto wallet</option>
                    <option value="fiat">Fiat bank</option>
                  </select>
                </div>
                {isFiat && (
                  <span className="text-label-sm text-on-surface-variant font-mono uppercase">
                    {fiatEnabled ? "Fiat payout enabled" : "Enter bank details"}
                  </span>
                )}
              </div>

              {isFiat && (
                <div className="grid grid-cols-3 gap-2">
                  <input
                    className="input"
                    placeholder="Account name"
                    value={bank.accountName}
                    onChange={(ev) => updateBankDetail(e.address, { accountName: ev.target.value })}
                  />
                  <input
                    className="input font-mono"
                    placeholder="Account number"
                    value={bank.accountNumber}
                    onChange={(ev) =>
                      updateBankDetail(e.address, { accountNumber: ev.target.value })
                    }
                  />
                  <input
                    className="input font-mono"
                    placeholder="Bank code"
                    value={bank.bankCode}
                    onChange={(ev) => updateBankDetail(e.address, { bankCode: ev.target.value })}
                  />
                </div>
              )}
            </div>
          );
        })}
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

      <button
        type="button"
        onClick={saveBankDetails}
        disabled={savingBanks}
        className="border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20 w-full rounded-lg border py-2.5 font-mono font-bold transition-colors disabled:opacity-50"
      >
        {savingBanks ? "SAVING BANK DETAILS…" : "SAVE BANK DETAILS"}
      </button>
    </div>
  );
}
