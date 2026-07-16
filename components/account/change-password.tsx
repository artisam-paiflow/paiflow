"use client";

import { useState } from "react";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-toast";

export default function ChangePassword() {
  const [busy, setBusy] = useState(false);

  async function onSubmit(formData: FormData) {
    setBusy(true);
    const currentPassword = String(formData.get("current") ?? "");
    const newPassword = String(formData.get("next") ?? "");
    const r = await fetch("/api/account/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    setBusy(false);
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      toastError(b, "Failed");
      return;
    }
    toast.success("Password changed. You will be signed out.");
    setTimeout(() => (window.location.href = "/login"), 800);
  }

  return (
    <section className="glass-panel mt-md p-md rounded-xl">
      <div className="flex items-center justify-between">
        <h2 className="text-headline-sm text-on-surface">Change password</h2>
        <span className="text-label-sm text-on-surface-variant font-mono">/ SECURITY</span>
      </div>
      <form action={onSubmit} className="mt-md gap-md grid max-w-md">
        <Field label="Current password" name="current" autoComplete="current-password" />
        <Field
          label="New password"
          name="next"
          autoComplete="new-password"
          minLength={12}
          helper="Min 12 characters"
        />
        <button
          type="submit"
          disabled={busy}
          className="bg-primary px-md py-sm text-label-md text-on-primary inline-flex items-center justify-center gap-2 rounded-lg font-mono font-bold transition-all duration-200 hover:-translate-y-px hover:shadow-[0_0_20px_rgba(255,177,196,0.55)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
        >
          {busy ? "SAVING…" : "SAVE"}
        </button>
      </form>
    </section>
  );
}

function Field({
  label,
  name,
  autoComplete,
  minLength,
  helper,
}: {
  label: string;
  name: string;
  autoComplete?: string;
  minLength?: number;
  helper?: string;
}) {
  return (
    <label className="group grid gap-1.5">
      <span className="text-label-sm text-on-surface-variant group-focus-within:text-primary font-mono uppercase transition-colors">
        {label}
      </span>
      <input
        type="password"
        name={name}
        required
        minLength={minLength}
        autoComplete={autoComplete}
        className="border-outline-variant/40 bg-surface-container-lowest text-on-surface focus:border-primary focus:ring-primary rounded border px-3 py-2 font-mono text-[14px] focus:ring-1 focus:outline-none"
      />
      {helper ? (
        <span className="text-label-sm text-on-surface-variant/70 font-mono">{helper}</span>
      ) : null}
    </label>
  );
}
