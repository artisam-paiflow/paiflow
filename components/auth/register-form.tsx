"use client";

import { useState } from "react";
import { toast } from "sonner";

export default function RegisterForm() {
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(formData: FormData) {
    setSubmitting(true);
    const username = String(formData.get("username") ?? "");
    const password = String(formData.get("password") ?? "");
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error?.message ?? "Registration failed");
      return;
    }
    toast.success("Account created. Please sign in.");
    window.location.href = "/login";
  }

  return (
    <form action={onSubmit} className="glass-panel mt-md gap-md p-md grid rounded-xl">
      <label className="group grid gap-1.5">
        <span className="text-label-sm text-on-surface-variant group-focus-within:text-primary font-mono uppercase transition-colors">
          Username
        </span>
        <input
          name="username"
          required
          minLength={3}
          maxLength={32}
          pattern="[a-zA-Z0-9_.\-]+"
          className="border-outline-variant/40 bg-surface-container-lowest text-on-surface focus:border-primary focus:ring-primary w-full rounded border px-3 py-2 font-mono text-[14px] focus:ring-1 focus:outline-none"
        />
        <span className="text-label-sm text-on-surface-variant/70 font-mono">
          3–32 chars · letters, digits, _ . -
        </span>
      </label>
      <label className="group grid gap-1.5">
        <span className="text-label-sm text-on-surface-variant group-focus-within:text-primary font-mono uppercase transition-colors">
          Password
        </span>
        <input
          type="password"
          name="password"
          required
          minLength={12}
          maxLength={256}
          className="border-outline-variant/40 bg-surface-container-lowest text-on-surface focus:border-primary focus:ring-primary w-full rounded border px-3 py-2 font-mono text-[14px] focus:ring-1 focus:outline-none"
        />
        <span className="text-label-sm text-on-surface-variant/70 font-mono">
          Min 12 characters
        </span>
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="bg-primary px-md py-sm text-label-md text-on-primary mt-2 inline-flex items-center justify-center gap-2 rounded-lg font-mono font-bold transition-all duration-200 hover:-translate-y-px hover:shadow-[0_0_20px_rgba(255,177,196,0.55)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        {submitting ? "CREATING…" : "CREATE ACCOUNT"}
        {!submitting ? (
          <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
        ) : null}
      </button>
    </form>
  );
}
