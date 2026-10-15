"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-toast";
import { trackWalletConnection } from "@/lib/wallet-tracking";
import { StrKey } from "@stellar/stellar-sdk";
import { formatStroops, formatAmount } from "@/lib/utils";
import type { Asset } from "@/lib/flows/schema";
import { assetLabel } from "@/lib/flows/schema";
import { usePollTxStatus } from "@/lib/hooks/use-poll-tx-status";
import { apiError } from "@/lib/friendly-error";
import {
  connectSelectedWallet,
  assertWalletAttemptActive,
} from "@/components/deploy/selected-wallet-connection";

import {
  CONTRACT_CALL_PENDING_EVENT,
  contractCallPendingKey,
  readPendingContractCall,
  withContractCallLock,
} from "@/lib/contract-call-pending";
import { readAllowancePendingHash } from "@/lib/subscription/allowance-pending";
import {
  clearPendingPayroll,
  payrollPendingKey,
  readPendingPayroll,
  savePendingPayroll,
  type PendingPayroll,
} from "@/lib/payroll-pending";

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
  network,
}: {
  deploymentId: string;
  asset: Asset;
  network: "testnet" | "mainnet";
}) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [bankDetails, setBankDetails] = useState<Record<string, BankDetail | null>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const attemptRef = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    setSaving(false);
    return () => {
      attemptRef.current?.abort();
    };
  }, [deploymentId, network]);
  const [savingBanks, setSavingBanks] = useState(false);
  const pollTxStatus = usePollTxStatus();
  const pendingKey = payrollPendingKey(deploymentId, network);
  const admissionKey = contractCallPendingKey(deploymentId, network);
  const [pending, setPending] = useState<PendingPayroll | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const cancelEditedAttempt = () => {
    attemptRef.current?.abort();
    setSaving(false);
  };
  function loadPending() {
    try {
      const saved = readPendingPayroll(pendingKey);
      setPending(saved);
      const contractPending = readPendingContractCall(admissionKey);
      const allowanceHash = readAllowancePendingHash(deploymentId, network);
      setRecoveryBlocked(Boolean(contractPending) || Boolean(allowanceHash));
      if (allowanceHash)
        setStatusMessage(
          "An allowance approval is unresolved. Check its status on the allowance page before updating payroll.",
        );
      else if (contractPending)
        setStatusMessage(
          "A contract action is unresolved. Check its status before updating payroll.",
        );
      return saved;
    } catch {
      setRecoveryBlocked(true);
      setStatusMessage(
        "Transaction recovery storage is unavailable or invalid. Resolve it before updating payroll.",
      );
      throw new Error("Transaction recovery storage is unavailable or invalid.");
    } finally {
      setRecoveryReady(true);
    }
  }
  async function reconcile(saved: PendingPayroll, current: () => boolean) {
    if (saved.phase === "prepare") {
      if (current())
        setStatusMessage(
          "The payroll request outcome is unknown and no transaction hashes were received. Further actions are blocked. Ask an operator to reconcile this request; do not repeat it or clear site storage.",
        );
      return;
    }
    try {
      const results = await Promise.all(
        saved.txHashes.map((hash) => pollTxStatus(deploymentId, hash)),
      );
      if (results.some((result) => result.status !== "SUCCESS" && result.status !== "FAILED"))
        throw new Error("Finality is unknown");
      clearPendingPayroll(pendingKey, saved);
      if (!current()) return;
      const failed = results.find((result) => result.status === "FAILED");
      if (failed) {
        setStatusMessage(
          "A payroll transaction failed on the network. The request may have partially completed; check the deployment before another update.",
        );
        toastError(new Error(failed.errorMessage ?? "Payroll transaction failed"), "Update failed");
      } else {
        setStatusMessage("Payroll transactions confirmed.");
        toast.success("Employees updated on-chain");
      }
    } catch {
      if (current())
        setStatusMessage(
          "Payroll transaction confirmation is still unknown. Check status before starting another action.",
        );
    }
  }
  async function checkStatus(saved: PendingPayroll) {
    if (attemptRef.current && !attemptRef.current.signal.aborted) return;
    const controller = new AbortController();
    attemptRef.current = controller;
    const current = () => attemptRef.current === controller && !controller.signal.aborted;
    setSaving(true);
    try {
      await withContractCallLock(admissionKey, async () => {
        const actual = readPendingPayroll(pendingKey);
        if (actual && JSON.stringify(actual) === JSON.stringify(saved))
          await reconcile(actual, current);
      });
    } catch {
      if (current())
        setStatusMessage("Another action is being processed. Payroll remains unresolved.");
    } finally {
      if (attemptRef.current === controller) {
        attemptRef.current = null;
        if (!controller.signal.aborted) setSaving(false);
      }
    }
  }
  useEffect(() => {
    setRecoveryReady(false);
    setStatusMessage(null);
    const refresh = () => {
      try {
        loadPending();
      } catch {
        /* Fail closed. */
      }
    };
    window.addEventListener("storage", refresh);
    window.addEventListener(CONTRACT_CALL_PENDING_EVENT, refresh);
    try {
      const saved = loadPending();
      if (saved) void checkStatus(saved);
    } catch {
      /* Fail closed. */
    }
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(CONTRACT_CALL_PENDING_EVENT, refresh);
    };
    // Status checks only; never repeat prepare or submit after reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey, admissionKey]);

  useEffect(() => {
    let live = true;
    setLoading(true);
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
        if (!live) return;
        setEmployees(emps);
        setBankDetails(banks);
      })
      .catch((err) => {
        if (live) toastError(err);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [deploymentId]);

  const total = employees.reduce((sum, e) => sum + BigInt(e.amount || "0"), 0n);

  const updateEmployee = (index: number, patch: Partial<Employee>) => {
    cancelEditedAttempt();
    setEmployees((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  };

  const updatePayoutMode = (index: number, mode: "crypto" | "fiat") => {
    cancelEditedAttempt();
    setEmployees((prev) => prev.map((e, i) => (i === index ? { ...e, payoutMode: mode } : e)));
  };

  const updateBankDetail = (address: string, patch: Partial<BankDetail>) => {
    cancelEditedAttempt();
    setBankDetails((prev) => {
      const current = prev[address] ?? { accountName: "", accountNumber: "", bankCode: "" };
      return { ...prev, [address]: { ...current, ...patch } };
    });
  };

  const addEmployee = () => {
    cancelEditedAttempt();
    setEmployees((prev) => [...prev, { address: "", amount: "", label: "" }]);
  };

  const removeEmployee = (index: number) => {
    cancelEditedAttempt();
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
    if (
      !validate() ||
      !recoveryReady ||
      recoveryBlocked ||
      pending ||
      (attemptRef.current && !attemptRef.current.signal.aborted)
    )
      return;
    const controller = new AbortController();
    attemptRef.current = controller;
    const { signal } = controller;
    const check = () => assertWalletAttemptActive(signal);
    const current = () => attemptRef.current === controller && !signal.aborted;
    // Capture immutable values before the first await. Editing invalidates the wallet attempt.
    const recipients = employees.map((e) => ({
      address: e.address,
      amount: e.amount,
      label: e.label || undefined,
      payoutMode: e.payoutMode ?? "crypto",
      bankDetail: bankDetails[e.address] ? { ...bankDetails[e.address]! } : undefined,
    }));
    setSaving(true);
    try {
      await withContractCallLock(admissionKey, async () => {
        let mayHaveWritten = false;
        let onAbort!: () => void;
        const cancelled = new Promise<never>((_resolve, reject) => {
          onAbort = () => {
            if (!mayHaveWritten) reject(new Error("Payroll update cancelled before submission."));
          };
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) onAbort();
        });
        const execute = async () => {
          check();
          if (
            readPendingContractCall(admissionKey) ||
            readAllowancePendingHash(deploymentId, network)
          )
            throw new Error("Resolve the pending transaction before updating payroll.");
          const existing = loadPending();
          if (existing) {
            mayHaveWritten = true;
            await reconcile(existing, current);
            return;
          }
          const request: PendingPayroll = { requestId: crypto.randomUUID(), phase: "prepare" };
          savePendingPayroll(pendingKey, request);
          mayHaveWritten = true;
          // This endpoint can submit relayer transactions. Do not abort or replay it.
          const res = await fetch(`/api/deployments/${deploymentId}/payroll-update-recipients`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ recipients }),
          });
          const json: unknown = await res.json();
          if (!res.ok) throw apiError(json, "Failed to prepare update");
          if (
            !json ||
            typeof json !== "object" ||
            !("data" in json) ||
            !json.data ||
            typeof json.data !== "object"
          )
            throw new Error("Invalid payroll response");
          const data = json.data;
          if ("txHashes" in data || "txHash" in data) {
            const hashes =
              "txHashes" in data ? data.txHashes : "txHash" in data ? [data.txHash] : [];
            if (!Array.isArray(hashes)) throw new Error("Invalid payroll hashes");
            // Parsing/persistence rejects invalid or empty lists, retaining unknown prepare.
            const saved: PendingPayroll = {
              requestId: request.requestId,
              phase: "transactions",
              txHashes: hashes,
            };
            savePendingPayroll(pendingKey, saved, request);
            await reconcile(saved, current);
            return;
          }
          if (
            !("unsignedXdr" in data) ||
            typeof data.unsignedXdr !== "string" ||
            !("networkPassphrase" in data) ||
            typeof data.networkPassphrase !== "string"
          )
            throw new Error("Missing transaction payload");
          // Only this route's PAYROLL branch returns unsigned-only; it has no chain write.
          // It can already have synced Employee DB records; cancellation is not a rollback.
          clearPendingPayroll(pendingKey, request);
          mayHaveWritten = false;
          check();
          const { unsignedXdr, networkPassphrase } = data;
          const { assertWalletNetwork, signedWalletTransactionHash } =
            await import("@/lib/stellar/wallet-signature");
          check();
          assertWalletNetwork(network, networkPassphrase);
          const { getWalletKit } = await import("@/components/deploy/wallet-kit");
          check();
          const shared = await getWalletKit(network);
          check();
          const connection = await connectSelectedWallet(shared, network, signal);
          check();
          if (!connection) {
            toast.warning("Update cancelled");
            return;
          }
          const { address, walletId } = connection;
          void trackWalletConnection({ address, network, walletId, surface: "payroll" });
          const { signedTxXdr } = await connection.signTransaction(unsignedXdr, {
            address,
            networkPassphrase,
          });
          check();
          const txHash = signedWalletTransactionHash(
            network,
            unsignedXdr,
            signedTxXdr,
            address,
            networkPassphrase,
          );
          const saved: PendingPayroll = {
            requestId: request.requestId,
            phase: "transactions",
            txHashes: [txHash],
          };
          if (
            readPendingContractCall(admissionKey) ||
            readAllowancePendingHash(deploymentId, network)
          )
            throw new Error(
              "Resolve the pending transaction or allowance approval before updating payroll.",
            );
          savePendingPayroll(pendingKey, saved);
          mayHaveWritten = true;
          try {
            void fetch(`/api/deployments/${deploymentId}/submit-invoke`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ signedXdr: signedTxXdr }),
            }).catch(() => {});
          } catch {
            /* Preserve hash even if dispatch/response fails. */
          }
          await reconcile(saved, current);
        };
        try {
          await Promise.race([execute(), cancelled]);
        } finally {
          signal.removeEventListener("abort", onAbort);
        }
      });
    } catch (err) {
      if (current()) {
        let saved: PendingPayroll | null = null;
        try {
          saved = loadPending();
        } catch {
          /* Fail closed. */
        }
        if (saved)
          setStatusMessage(
            saved.phase === "prepare"
              ? "The payroll request outcome is unknown and no transaction hashes were received. Further actions are blocked. Ask an operator to reconcile this request; do not repeat it or clear site storage."
              : "Payroll transaction confirmation is still unknown. Check status before another action.",
          );
        else toastError(err, "Update failed");
      }
    } finally {
      if (attemptRef.current === controller) {
        attemptRef.current = null;
        if (!signal.aborted) setSaving(false);
      }
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
          throw apiError(json, `Failed to save bank details for ${e.address}`);
        }
      }
      toast.success("Bank details saved");
    } catch (err) {
      toastError(err, "Bank details save failed");
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
        disabled={saving || !recoveryReady || recoveryBlocked || Boolean(pending)}
        className="bg-primary text-on-primary hover:shadow-primary/50 w-full rounded-lg py-2.5 font-mono font-bold transition-shadow disabled:opacity-50"
      >
        {saving ? "SAVING…" : "SAVE EMPLOYEES"}
      </button>

      {(pending || statusMessage || recoveryBlocked) && (
        <div role="status" className="text-on-surface-variant space-y-2 text-xs">
          <p>
            {statusMessage ??
              (pending?.phase === "prepare"
                ? "The payroll request outcome is unresolved. Ask an operator to reconcile it before another action."
                : "A transaction is awaiting confirmation. Check status before another action.")}
          </p>
          {pending?.phase === "transactions" && (
            <>
              <ul>
                {pending.txHashes.map((hash) => (
                  <li key={hash} className="font-mono break-all">
                    {hash}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={saving}
                onClick={() => void checkStatus(pending)}
                className="text-secondary underline"
              >
                CHECK PAYROLL STATUS
              </button>
            </>
          )}
        </div>
      )}
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
