"use client";

import { useState } from "react";
import type { SenderKyc } from "@/lib/flows/schema";
import { COUNTRY_OPTIONS, SOURCE_OF_FUNDS_OPTIONS } from "@/components/payroll/offramp-sender-form";

type FormState = {
  firstName: string;
  middleName: string;
  lastName: string;
  countryOrigin: string;
  sourceOfFunds: string;
};

const EMPTY: FormState = {
  firstName: "",
  middleName: "",
  lastName: "",
  countryOrigin: "",
  sourceOfFunds: "",
};

// Design-time sender KYC dialog: collects the PDAX-required sender profile in
// the builder so non-dev flows with fiat payouts deploy with it on file. The
// field layout/labels mirror components/payroll/offramp-sender-form.tsx, which
// remains the post-deploy editing path.
export default function SenderKycDialog({
  initial,
  onSave,
  onClose,
}: {
  initial?: SenderKyc;
  onSave: (kyc: SenderKyc) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>({ ...EMPTY, ...initial });
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const save = () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError("First name and last name are required");
      return;
    }
    if (!form.countryOrigin) {
      setError("Country of origin is required");
      return;
    }
    if (!form.sourceOfFunds) {
      setError("Source of funds is required");
      return;
    }
    onSave({
      firstName: form.firstName.trim(),
      middleName: form.middleName.trim() || undefined,
      lastName: form.lastName.trim(),
      countryOrigin: form.countryOrigin,
      sourceOfFunds: form.sourceOfFunds,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sender KYC"
        className="bg-background-1 relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl">verified_user</span>
            <h3 className="text-label-lg text-on-background font-bold">Sender KYC</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-on-background/60 hover:text-on-background flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-zinc-800"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <p className="text-label-sm text-on-surface-variant leading-snug">
            PDAX requires the sender&apos;s KYC profile for every fiat payout. This is saved with
            the flow and applied to each deployment automatically.
          </p>

          <div className="grid grid-cols-3 gap-2">
            <input
              className="bg-surface-container text-on-surface border-outline-variant/40 placeholder:text-on-surface-variant/80 focus:border-primary w-full rounded-md border px-3 py-2 text-sm outline-none"
              placeholder="First name *"
              value={form.firstName}
              onChange={(e) => update({ firstName: e.target.value })}
            />
            <input
              className="bg-surface-container text-on-surface border-outline-variant/40 placeholder:text-on-surface-variant/80 focus:border-primary w-full rounded-md border px-3 py-2 text-sm outline-none"
              placeholder="Middle name (n.a. if none)"
              value={form.middleName}
              onChange={(e) => update({ middleName: e.target.value })}
            />
            <input
              className="bg-surface-container text-on-surface border-outline-variant/40 placeholder:text-on-surface-variant/80 focus:border-primary w-full rounded-md border px-3 py-2 text-sm outline-none"
              placeholder="Last name *"
              value={form.lastName}
              onChange={(e) => update({ lastName: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select
              className="bg-surface-container text-on-surface border-outline-variant/40 focus:border-primary w-full rounded-md border px-3 py-2 text-sm outline-none"
              value={form.countryOrigin}
              onChange={(e) => update({ countryOrigin: e.target.value })}
            >
              <option value="" disabled>
                Country of origin *
              </option>
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              className="bg-surface-container text-on-surface border-outline-variant/40 focus:border-primary w-full rounded-md border px-3 py-2 text-sm outline-none"
              value={form.sourceOfFunds}
              onChange={(e) => update({ sourceOfFunds: e.target.value })}
            >
              <option value="" disabled>
                Source of funds *
              </option>
              {SOURCE_OF_FUNDS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-label-sm text-error" role="alert">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={save}
            className="bg-secondary/10 text-secondary hover:bg-secondary/20 border-secondary/40 w-full rounded border py-2 font-mono font-bold"
          >
            SAVE SENDER KYC
          </button>
        </div>
      </div>
    </div>
  );
}
