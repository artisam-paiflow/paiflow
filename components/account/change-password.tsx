"use client";

import { useState } from "react";
import { toast } from "sonner";

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
      toast.error(b?.error?.message ?? "Failed");
      return;
    }
    toast.success("Password changed. You will be signed out.");
    setTimeout(() => (window.location.href = "/login"), 800);
  }

  return (
    <section className="mt-10 rounded-xl border border-zinc-800 p-6">
      <h2 className="text-xl font-semibold">Change password</h2>
      <form action={onSubmit} className="mt-4 grid max-w-md gap-3 text-sm">
        <label className="grid gap-1">
          <span className="text-zinc-400">Current password</span>
          <input
            type="password"
            name="current"
            required
            autoComplete="current-password"
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-zinc-400">New password (min 12 chars)</span>
          <input
            type="password"
            name="next"
            required
            minLength={12}
            autoComplete="new-password"
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="bg-brand-600 hover:bg-brand-500 rounded-md px-4 py-2 font-medium disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </form>
    </section>
  );
}
